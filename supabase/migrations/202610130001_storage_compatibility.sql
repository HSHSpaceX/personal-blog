-- Forward-only, once per installed database. Never changes storage.objects ownership,
-- indexes or triggers. Existing original triggers may remain as defense in depth.
begin;
do $$
begin
 if to_regclass('public.dm_assets') is null or to_regclass('public.community_legacy_mappings') is null then
  raise exception 'Incomplete installation: run read-only preflight and complete the audited prerequisites first';
 end if;
 if not exists(select 1 from pg_index x where x.indrelid='storage.objects'::regclass and x.indisunique and x.indisvalid
  and x.indpred is null and x.indexprs is null and x.indnkeyatts=2
  and (select array_agg(a.attname::text order by a.attname) from unnest(x.indkey::smallint[]) with ordinality k(n,p)
       join pg_attribute a on a.attrelid=x.indrelid and a.attnum=k.n where k.p<=x.indnkeyatts)=array['bucket_id','name']) then
  raise exception 'Storage must provide its native unique (bucket_id,name) index; stop and ask platform support. Do not create a managed index here';
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.dm_assets'::regclass and conname='dm_assets_storage_object_id_fkey' and confrelid='storage.objects'::regclass and confdeltype='c')
 or not exists(select 1 from pg_constraint where conrelid='public.user_assets'::regclass and conname='user_assets_storage_object_id_fkey' and confrelid='storage.objects'::regclass and confdeltype='c') then
  raise exception 'Unexpected asset FK definitions or repair already applied; inspect preflight, do not overwrite';
 end if;
end $$;

-- Registered objects cannot disappear under a concurrent send/registration.
-- Only the owning application registry is altered, never the managed table.
alter table public.dm_assets drop constraint dm_assets_storage_object_id_fkey;
alter table public.dm_assets add constraint dm_assets_storage_object_id_fkey foreign key(storage_object_id) references storage.objects(id) on delete restrict;
alter table public.user_assets drop constraint user_assets_storage_object_id_fkey;
alter table public.user_assets add constraint user_assets_storage_object_id_fkey foreign key(storage_object_id) references storage.objects(id) on delete restrict;
create table public.private_object_tombstones (
 bucket_id text not null check(bucket_id in ('dm-media','community-assets')), object_path text not null,
 owner_id uuid not null, prepared_at timestamptz not null default now(), primary key(bucket_id,object_path)
);
alter table public.private_object_tombstones enable row level security;
revoke all on public.private_object_tombstones from public,anon,authenticated;

create function public.private_object_can_insert(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.private_object_tombstones where bucket_id=p_bucket and object_path=p_path);
$$;
revoke all on function public.private_object_can_insert(text,text) from public,anon,authenticated;
-- Guard registration in application-owned tables. A client can re-upload an
-- unregistered object at an abandoned path, but can never attach that path to
-- content/messages again. No policy DDL on the managed table is required.

create function public.private_object_guard_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare bucket text;
begin
 bucket:=case tg_table_name when 'dm_assets' then 'dm-media' else 'community-assets' end;
 perform 1 from storage.objects where id=new.storage_object_id and bucket_id=bucket and name=new.object_path for share;
 if not found or not public.private_object_can_insert(bucket,new.object_path) then
  raise exception 'Object unavailable or reserved for deletion; upload under a new path' using errcode='23514';
 end if;
 if tg_op='UPDATE' and (new.storage_object_id is distinct from old.storage_object_id or new.object_path is distinct from old.object_path or new.owner_id is distinct from old.owner_id or new.mime_type is distinct from old.mime_type or new.size_bytes is distinct from old.size_bytes) then
  raise exception 'Registered asset identity is immutable' using errcode='23514';
 end if;
 return new;
end $$;
create trigger dm_registration_guard before insert or update on public.dm_assets for each row execute function public.private_object_guard_registration();
create trigger community_registration_guard before insert or update on public.user_assets for each row execute function public.private_object_guard_registration();
revoke all on function public.private_object_guard_registration() from public,anon,authenticated;

create function public.private_object_prepare_delete(p_bucket text,p_asset uuid,p_object uuid) returns text
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; oid uuid; path text;
begin
 if auth.uid() is null or p_bucket not in ('dm-media','community-assets') or (p_asset is null)=(p_object is null) then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_asset is not null then
  if p_bucket='dm-media' then select storage_object_id into oid from public.dm_assets where id=p_asset and owner_id=auth.uid();
  else select storage_object_id into oid from public.user_assets where id=p_asset and owner_id=auth.uid();end if;
 else oid:=p_object;end if;
 -- Same object-first ordering as send/registration and actual Storage deletion.
 select * into obj from storage.objects where id=oid and bucket_id=p_bucket and split_part(name,'/',1)=auth.uid()::text for update;
 if obj.id is null then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_asset is null then
  if exists(select 1 from public.dm_assets where storage_object_id=obj.id) or exists(select 1 from public.user_assets where storage_object_id=obj.id) then raise exception 'Object is registered; use resource deletion' using errcode='23514';end if;
 elsif p_bucket='dm-media' then
  perform 1 from public.dm_assets where id=p_asset and storage_object_id=obj.id and owner_id=auth.uid() for update;
  if not found then raise exception 'Asset unavailable';end if;
  if exists(select 1 from public.dm_message_assets where asset_id=p_asset) then raise exception 'Sent images cannot be deleted' using errcode='23503';end if;
 else
  perform 1 from public.user_assets where id=p_asset and storage_object_id=obj.id and owner_id=auth.uid() for update;
  if not found then raise exception 'Asset unavailable';end if;
  if exists(select 1 from public.revision_assets where asset_id=p_asset) then raise exception 'Asset is referenced by revisions' using errcode='23503';end if;
 end if;
 insert into public.private_object_tombstones(bucket_id,object_path,owner_id) values(p_bucket,obj.name,auth.uid()) on conflict do nothing;
 if p_bucket='dm-media' then
  insert into public.dm_asset_delete_intents values(auth.uid(),obj.name,case when p_asset is null then 'orphan' else 'registered' end) on conflict(owner_id,object_path) do nothing;
  if p_asset is not null then delete from public.dm_assets where id=p_asset;end if;
 else
  insert into public.community_asset_delete_intents values(auth.uid(),obj.name,case when p_asset is null then 'orphan' else 'registered' end) on conflict(owner_id,object_path) do nothing;
  if p_asset is not null then delete from public.user_assets where id=p_asset;end if;
 end if;
 return obj.name;
end $$;
revoke all on function public.private_object_prepare_delete(text,uuid,uuid) from public,anon,authenticated;
create or replace function public.dm_prepare_asset_delete(p_asset_id uuid) returns text language sql security definer set search_path='' as $$select public.private_object_prepare_delete('dm-media',p_asset_id,null)$$;
create or replace function public.dm_prepare_orphan_delete(p_object_id uuid) returns text language sql security definer set search_path='' as $$select public.private_object_prepare_delete('dm-media',null,p_object_id)$$;
create or replace function public.community_prepare_asset_delete(p_asset_id uuid) returns text language sql security definer set search_path='' as $$select public.private_object_prepare_delete('community-assets',p_asset_id,null)$$;
create or replace function public.community_prepare_orphan_delete(p_object_id uuid) returns text language sql security definer set search_path='' as $$select public.private_object_prepare_delete('community-assets',null,p_object_id)$$;

-- Explicit finalization after Storage HTTP success. A crash can leave an intent;
-- retry this RPC, or run the owner-scoped sweep. Tombstones are intentionally retained.
create function public.private_object_finish_deletes() returns integer language plpgsql security definer set search_path='' as $$
declare n integer; total integer;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 delete from public.dm_asset_delete_intents d where owner_id=auth.uid() and not exists(select 1 from storage.objects o where o.bucket_id='dm-media' and o.name=d.object_path);get diagnostics total=row_count;
 delete from public.community_asset_delete_intents d where owner_id=auth.uid() and not exists(select 1 from storage.objects o where o.bucket_id='community-assets' and o.name=d.object_path);get diagnostics n=row_count;
 return total+n;
end $$;
revoke all on function public.private_object_finish_deletes() from public,anon,authenticated;
grant execute on function public.private_object_finish_deletes() to authenticated;
commit;
