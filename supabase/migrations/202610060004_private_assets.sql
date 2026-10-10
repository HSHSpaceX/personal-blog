-- Private immutable Storage objects with real revision -> registry -> object FKs.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-assets','community-assets',false,20971520,
  array['image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=excluded.allowed_mime_types;
alter table public.user_assets add column storage_object_id uuid unique references storage.objects(id) on delete cascade;
create table public.revision_assets (
  revision_id uuid not null references public.content_revisions(id) on delete cascade,
  asset_id uuid not null references public.user_assets(id) on delete no action deferrable initially deferred,
  primary key(revision_id,asset_id)
);
create index revision_assets_asset on public.revision_assets(asset_id);
alter table public.revision_assets enable row level security;
create policy revision_assets_private on public.revision_assets for select to authenticated
  using(exists(select 1 from public.content_revisions r join public.content_items i on i.id=r.item_id
    where r.id=revision_id and (i.author_id=(select auth.uid()) or public.is_admin())));
revoke all on public.revision_assets from public,anon,authenticated;
grant select on public.revision_assets to authenticated;
-- Round 1 column grants survive a table REVOKE: explicitly remove them as well.
revoke all on public.user_assets from public,anon,authenticated;
revoke all(owner_id,bucket_id,object_path,original_name,mime_type,size_bytes) on public.user_assets from public,anon,authenticated;
revoke all(original_name) on public.user_assets from public,anon,authenticated;
grant select on public.user_assets to authenticated;

-- Restrictive policies also protect this bucket if a project has broad custom
-- permissive Storage policies. Existing avatars behavior is unchanged.
create policy community_assets_read on storage.objects for select to authenticated
  using(bucket_id='community-assets' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.is_admin()));
create policy community_assets_read_guard on storage.objects as restrictive for select to anon,authenticated
  using(bucket_id<>'community-assets' or ((select auth.uid()) is not null and
    ((storage.foldername(name))[1]=(select auth.uid())::text or public.is_admin())));
create policy community_assets_insert on storage.objects for insert to authenticated
  with check(bucket_id='community-assets' and (storage.foldername(name))[1]=(select auth.uid())::text
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|pdf|txt)$');
create policy community_assets_insert_guard on storage.objects as restrictive for insert to anon,authenticated
  with check(bucket_id<>'community-assets' or ((select auth.uid()) is not null
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|pdf|txt)$'));
create policy community_assets_delete on storage.objects for delete to authenticated
  using(bucket_id='community-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy community_assets_delete_guard on storage.objects as restrictive for delete to anon,authenticated
  using(bucket_id<>'community-assets' or ((select auth.uid()) is not null
    and (storage.foldername(name))[1]=(select auth.uid())::text));
create policy community_assets_update_guard on storage.objects as restrictive for update to anon,authenticated
  using(bucket_id<>'community-assets') with check(bucket_id<>'community-assets');
-- RLS doesn't constrain privileged Storage service changes. Guard registered
-- objects against replacement; FK CASCADE + deferred NO ACTION protects ALL referenced revisions.
create function public.community_guard_registered_object() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.user_assets where storage_object_id=old.id) then
    raise exception 'Registered community assets are immutable' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger community_assets_immutable before update on storage.objects for each row
  when(old.bucket_id='community-assets') execute function public.community_guard_registered_object();

create function public.community_register_asset(p_object_path text,p_original_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare obj storage.objects; asset_id uuid; mime text; bytes bigint;
begin
  if auth.uid() is null or split_part(p_object_path,'/',1) is distinct from auth.uid()::text then
    raise exception 'Asset unavailable' using errcode='42501'; end if;
  if p_original_name is null or char_length(p_original_name)>255 or char_length(btrim(p_original_name))<1 then
    raise exception 'Invalid asset name' using errcode='22023'; end if;
  select * into obj from storage.objects where bucket_id='community-assets' and name=p_object_path for share;
  if obj.id is null then raise exception 'Upload the private object first' using errcode='22023'; end if;
  mime:=obj.metadata->>'mimetype'; bytes:=(obj.metadata->>'size')::bigint;
  if mime is null or mime not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain')
    or bytes is null or bytes not between 1 and 20971520 then
    raise exception 'Unsupported asset metadata' using errcode='22023'; end if;
  insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes,storage_object_id)
    values(auth.uid(),p_object_path,p_original_name,mime,bytes,obj.id) returning id into asset_id;
  return asset_id;
end;
$$;
create or replace function public.community_save_revision(p_item_id uuid,p_title text,p_body jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare item public.content_items; rid uuid; next_no integer; ids uuid[]; asset_id uuid; asset public.user_assets;
begin
  select * into item from public.content_items where id=p_item_id for update;
  if auth.uid() is null or item.author_id is distinct from auth.uid() then
    raise exception 'Content unavailable' using errcode='42501'; end if;
  if p_title is null or char_length(p_title)>160 or char_length(btrim(p_title))<1 then
    raise exception 'Invalid content title' using errcode='22023'; end if;
  ids:=public.community_validate_body(item.content_type,p_body);
  -- Same lock order as Storage DELETE: object before registry. Deterministic
  -- ordering across assets avoids cycles; deletion waits until references commit.
  for asset_id in select id from unnest(ids) id order by id loop
    select * into asset from public.user_assets where id=asset_id and owner_id=item.author_id;
    if asset.id is null or asset.storage_object_id is null then raise exception 'Asset unavailable' using errcode='42501'; end if;
    perform 1 from storage.objects where id=asset.storage_object_id for share;
    if not found then raise exception 'Asset unavailable' using errcode='42501'; end if;
    perform 1 from public.user_assets where id=asset_id for update;
    if not found then raise exception 'Asset unavailable' using errcode='42501'; end if;
    if item.content_type='album' and asset.mime_type not in ('image/jpeg','image/png','image/webp') then
      raise exception 'Album photos must be images' using errcode='22023'; end if;
  end loop;
  select coalesce(max(revision_no),0)+1 into next_no from public.content_revisions where item_id=p_item_id;
  insert into public.content_revisions(item_id,revision_no,title,body) values(p_item_id,next_no,p_title,p_body) returning id into rid;
  insert into public.revision_assets(revision_id,asset_id) select rid,id from unnest(ids) id;
  return rid;
end;
$$;
-- Also validate pre-Round-2 drafts on submission, so old arbitrary JSON cannot
-- introduce body-only references that skip the junction/FK protections.
create function public.community_check_revision_assets() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; owner uuid; ids uuid[]; actual uuid[];
begin
  select content_type,author_id into kind,owner from public.content_items where id=new.item_id;
  ids:=public.community_validate_body(kind,new.body);
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from unnest(ids) id;
  select coalesce(array_agg(asset_id order by asset_id),'{}'::uuid[]) into actual from public.revision_assets where revision_id=new.id;
  if ids<>actual or exists(select 1 from public.revision_assets r join public.user_assets a on a.id=r.asset_id
    where r.revision_id=new.id and (a.owner_id<>owner or a.storage_object_id is null)) then
    raise exception 'Invalid revision asset references' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger community_submission_assets before update of status on public.content_revisions for each row
  when(old.status='draft' and new.status in ('pending','approved')) execute function public.community_check_revision_assets();
revoke all on function public.community_check_revision_assets() from public,anon,authenticated;
revoke all on function public.community_register_asset(text,text),public.community_guard_registered_object() from public,anon,authenticated;
grant execute on function public.community_register_asset(text,text) to authenticated;
commit;
