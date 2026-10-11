-- Owner-only resource pages/metadata and Storage-API deletion preparation.
begin;
create table public.community_asset_delete_intents (
 owner_id uuid not null references auth.users(id) on delete cascade, object_path text not null,
 deletion_kind text not null check(deletion_kind in ('registered','orphan')), primary key(owner_id,object_path)
);
alter table public.community_asset_delete_intents enable row level security;
revoke all on public.community_asset_delete_intents from public,anon,authenticated;
create function public.community_assets_page(p_search text default '',p_kind text default 'all',p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,original_name text,mime_type text,size_bytes bigint,created_at timestamptz,reference_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 perform public.community_check_page(p_limit,p_offset);
 if p_search is null or char_length(p_search)>120 or p_kind is null or p_kind not in ('all','image','video','document') then
 raise exception 'Invalid asset filter' using errcode='22023'; end if;
 return query select a.id,a.original_name,a.mime_type,a.size_bytes,a.created_at,
 (select count(*) from public.revision_assets r where r.asset_id=a.id)
 from public.user_assets a where a.owner_id=auth.uid() and strpos(lower(a.original_name),lower(p_search))>0
 and (p_kind='all' or (p_kind='image' and a.mime_type like 'image/%') or
 (p_kind='video' and a.mime_type like 'video/%') or (p_kind='document' and a.mime_type in ('application/pdf','text/plain')))
 order by a.created_at desc,a.id limit p_limit offset p_offset;
end; $$;
create function public.community_asset_references(p_asset_id uuid,p_limit integer default 20,p_offset integer default 0)
returns table(revision_id uuid,item_id uuid,title text,status text,revision_no integer,is_current_public boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.user_assets a where a.id=p_asset_id and a.owner_id=auth.uid()) then
 raise exception 'Asset unavailable' using errcode='42501'; end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select r.id,r.item_id,r.title,r.status,r.revision_no,i.published_revision_id=r.id
 from public.revision_assets ref join public.content_revisions r on r.id=ref.revision_id join public.content_items i on i.id=r.item_id
 where ref.asset_id=p_asset_id order by r.created_at desc,r.id limit p_limit offset p_offset;
end; $$;
create function public.community_rename_asset(p_asset_id uuid,p_name text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Asset unavailable' using errcode='42501'; end if;
 if p_name is null or char_length(p_name)>255 or char_length(btrim(p_name))<1 then raise exception 'Invalid asset name' using errcode='22023'; end if;
 update public.user_assets set original_name=p_name where id=p_asset_id and owner_id=auth.uid();
 if not found then raise exception 'Asset unavailable' using errcode='42501'; end if;
end; $$;
create function public.community_orphan_assets(p_limit integer default 20,p_offset integer default 0)
returns table(object_id uuid,object_path text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select o.id,o.name from storage.objects o where o.bucket_id='community-assets'
 and (storage.foldername(o.name))[1]=auth.uid()::text
 and not exists(select 1 from public.user_assets a where a.storage_object_id=o.id or (a.bucket_id=o.bucket_id and a.object_path=o.name))
 order by o.name,o.id limit p_limit offset p_offset;
end; $$;
create function public.community_prepare_asset_delete(p_asset_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a public.user_assets;
begin
 select * into a from public.user_assets where id=p_asset_id and owner_id=auth.uid();
 if auth.uid() is null or a.id is null then raise exception 'Asset unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.revision_assets where asset_id=a.id) then raise exception 'Asset is referenced by revisions; inspect its references' using errcode='23503'; end if;
 insert into public.community_asset_delete_intents(owner_id,object_path,deletion_kind) values(auth.uid(),a.object_path,'registered')
 on conflict(owner_id,object_path) do update set deletion_kind='registered';
 return a.object_path;
end; $$;
create function public.community_prepare_orphan_delete(p_object_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare o storage.objects;
begin
 select * into o from storage.objects where id=p_object_id and bucket_id='community-assets'
 and (storage.foldername(name))[1]=auth.uid()::text for share;
 if auth.uid() is null or o.id is null then raise exception 'Orphan unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.user_assets a where a.storage_object_id=o.id or (a.bucket_id=o.bucket_id and a.object_path=o.name)) then
 raise exception 'Object is registered; use resource deletion' using errcode='23514'; end if;
 insert into public.community_asset_delete_intents(owner_id,object_path,deletion_kind) values(auth.uid(),o.name,'orphan')
 on conflict(owner_id,object_path) do update set deletion_kind='orphan';
 return o.name;
end; $$;
-- A registry can appear between preparation and Storage API DELETE. Check again
-- at actual DELETE, after its object lock; no time-based expiration opens a race.
create function public.community_guard_orphan_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.community_asset_delete_intents d where d.object_path=old.name
 and d.owner_id::text=(storage.foldername(old.name))[1] and d.deletion_kind='orphan') and
 exists(select 1 from public.user_assets a where a.storage_object_id=old.id or (a.bucket_id=old.bucket_id and a.object_path=old.name)) then
 raise exception 'Orphan became registered; use resource deletion' using errcode='23514'; end if;
 return old;
end; $$;
create function public.community_clear_delete_intent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.community_asset_delete_intents where object_path=old.name and owner_id::text=(storage.foldername(old.name))[1];
 return old;
end; $$;
create trigger community_orphan_delete_guard before delete on storage.objects for each row
 when(old.bucket_id='community-assets') execute function public.community_guard_orphan_delete();
create trigger community_delete_intent_cleanup after delete on storage.objects for each row
 when(old.bucket_id='community-assets') execute function public.community_clear_delete_intent();
revoke all on function public.community_guard_orphan_delete(),public.community_clear_delete_intent() from public,anon,authenticated;
revoke all on function public.community_assets_page(text,text,integer,integer),public.community_asset_references(uuid,integer,integer),
 public.community_rename_asset(uuid,text),public.community_orphan_assets(integer,integer),public.community_prepare_asset_delete(uuid),
 public.community_prepare_orphan_delete(uuid) from public,anon,authenticated;
grant execute on function public.community_assets_page(text,text,integer,integer),public.community_asset_references(uuid,integer,integer),
 public.community_rename_asset(uuid,text),public.community_orphan_assets(integer,integer),public.community_prepare_asset_delete(uuid),
 public.community_prepare_orphan_delete(uuid) to authenticated;
commit;
