-- Frozen compatibility runtime from commit 98cf633; fixture only, not a standalone migration.
-- Application-owned helpers only. The installer validates the table shape first.
create function public.private_object_is_current(p_object storage.objects) returns boolean
language sql immutable set search_path='' as $$
 select p_object.id is not null and case when to_jsonb(p_object) ? 'archived_at' then
  to_jsonb(p_object)->>'archived_at' is null and to_jsonb(p_object)->>'is_delete_marker'='false'
  else true end;
$$;
revoke all on function public.private_object_is_current(storage.objects) from public,anon,authenticated;

create function public.private_object_require_disabled(p_bucket text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_bucket is null or p_bucket not in ('dm-media','community-assets') or not exists(
  select 1 from storage.buckets b where b.id=p_bucket and b.public=false
  and (not (to_jsonb(b) ? 'versioning_status') or to_jsonb(b)->>'versioning_status'='DISABLED')) then
  raise exception 'Private bucket must remain DISABLED' using errcode='23514';end if;
end $$;
revoke all on function public.private_object_require_disabled(text) from public,anon,authenticated;

-- Fail without changing existing registrations/data if a historical install has
-- already attached an archived row, marker, different path or mismatched metadata.
do $$
begin
 if exists(select 1 from (
  select 'dm-media' bucket_id,storage_object_id,object_path,owner_id,mime_type,size_bytes from public.dm_assets
  union all select bucket_id,storage_object_id,object_path,owner_id,mime_type,size_bytes from public.user_assets
 ) a left join storage.objects o on o.id=a.storage_object_id
 where not coalesce(public.private_object_is_current(o),false) or o.bucket_id is distinct from a.bucket_id
 or o.name is distinct from a.object_path or split_part(a.object_path,'/',1) is distinct from a.owner_id::text
 or o.metadata->>'mimetype' is distinct from a.mime_type or o.metadata->>'size' is distinct from a.size_bytes::text) then
  raise exception 'Storage contract: existing registry/object mismatch; preserve data and inspect read-only diagnostics';end if;
end $$;

create or replace function public.dm_register_asset(p_object_path text,p_original_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; aid uuid; mime text; bytes bigint;
begin
 perform public.private_object_require_disabled('dm-media');
 if auth.uid() is null or split_part(p_object_path,'/',1) is distinct from auth.uid()::text then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_original_name is null or char_length(p_original_name)>255 or char_length(btrim(p_original_name))<1 then raise exception 'Invalid image name' using errcode='22023';end if;
 if p_object_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$' then raise exception 'Invalid image path' using errcode='22023';end if;
 select * into obj from storage.objects o where public.private_object_is_current(o) and bucket_id='dm-media' and name=p_object_path for share;
 if obj.id is null then raise exception 'Upload the private image first' using errcode='22023';end if;
 mime:=obj.metadata->>'mimetype';
 if obj.metadata->>'size' is null or obj.metadata->>'size' !~ '^[0-9]{1,9}$' then raise exception 'Invalid image metadata' using errcode='22023';end if;
 bytes:=(obj.metadata->>'size')::bigint;
 if mime is null or mime not in ('image/jpeg','image/png','image/webp') or bytes not between 1 and 8388608 or
 split_part(p_object_path,'.',2)<>(case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end) then
 raise exception 'Unsupported image metadata' using errcode='22023';end if;
 insert into public.dm_assets(owner_id,storage_object_id,object_path,original_name,mime_type,size_bytes)
 values(auth.uid(),obj.id,p_object_path,p_original_name,mime,bytes) returning id into aid;return aid;
end; $$;

create or replace function public.community_register_asset(p_object_path text,p_original_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; asset_id uuid; mime text; bytes bigint;
begin
 perform public.private_object_require_disabled('community-assets');
 if auth.uid() is null or split_part(p_object_path,'/',1) is distinct from auth.uid()::text then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_original_name is null or char_length(p_original_name) not between 1 and 255 or char_length(btrim(p_original_name))<1 or p_original_name ~ '[/\\[:cntrl:]]' then raise exception 'Invalid asset name' using errcode='22023';end if;
 select * into obj from storage.objects o where public.private_object_is_current(o) and bucket_id='community-assets' and name=p_object_path for share;
 if obj.id is null then raise exception 'Upload the private object first' using errcode='22023';end if;
 mime:=obj.metadata->>'mimetype';bytes:=(obj.metadata->>'size')::bigint;
 if mime is null or mime not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain') or bytes is null or bytes not between 1 and 94371840 then raise exception 'Unsupported asset metadata' using errcode='22023';end if;
 insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes,storage_object_id) values(auth.uid(),p_object_path,p_original_name,mime,bytes,obj.id) returning id into asset_id;
 return asset_id;
end; $$;

create or replace function public.community_register_legacy_asset(p_owner uuid,p_path text,p_name text,p_mime text,p_size bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; asset_id uuid;
begin
 perform public.private_object_require_disabled('community-assets');
 if p_owner is null or p_owner is distinct from (select legacy_author_id from public.community_publication_config where singleton) or split_part(p_path,'/',1)<>p_owner::text then raise exception 'Configured legacy owner required' using errcode='42501';end if;
 select * into obj from storage.objects o where public.private_object_is_current(o) and bucket_id='community-assets' and name=p_path for share;
 if obj.id is null or obj.metadata->>'mimetype' is distinct from p_mime or (obj.metadata->>'size')::bigint is distinct from p_size or p_size not between 1 and 94371840 or p_mime not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain') or p_name is null or char_length(p_name) not between 1 and 255 or p_name ~ '[/\\[:cntrl:]]' then raise exception 'Invalid legacy asset metadata' using errcode='22023';end if;
 select id into asset_id from public.user_assets where storage_object_id=obj.id;
 if found then
  if not exists(select 1 from public.user_assets where id=asset_id and owner_id=p_owner and bucket_id='community-assets'
   and object_path=p_path and mime_type=p_mime and size_bytes=p_size)
   or not public.private_object_can_insert('community-assets',p_path) then
   raise exception 'Legacy registry mismatch or reserved for deletion' using errcode='23514';end if;
  return asset_id;end if;
 insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes,storage_object_id) values(p_owner,p_path,p_name,p_mime,p_size,obj.id) returning id into asset_id;
 return asset_id;
end;$$;

create or replace function public.dm_orphan_assets(p_limit integer default 20,p_offset integer default 0)
returns table(object_id uuid,object_path text) language plpgsql stable security definer set search_path='' as $$
begin
 perform public.private_object_require_disabled('dm-media');
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select o.id,o.name from storage.objects o where public.private_object_is_current(o) and o.bucket_id='dm-media' and (storage.foldername(o.name))[1]=auth.uid()::text
 and not exists(select 1 from public.dm_assets a where a.storage_object_id=o.id or a.object_path=o.name)
 order by o.name,o.id limit p_limit offset p_offset;
end; $$;

create or replace function public.community_orphan_assets(p_limit integer default 20,p_offset integer default 0)
returns table(object_id uuid,object_path text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.private_object_require_disabled('community-assets');
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select o.id,o.name from storage.objects o where public.private_object_is_current(o) and o.bucket_id='community-assets'
 and (storage.foldername(o.name))[1]=auth.uid()::text
 and not exists(select 1 from public.user_assets a where a.storage_object_id=o.id or (a.bucket_id=o.bucket_id and a.object_path=o.name))
 order by o.name,o.id limit p_limit offset p_offset;
end; $$;

create or replace function public.dm_send_message(p_thread_id uuid,p_body text,p_asset_ids uuid[] default '{}',p_expected_sender_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.dm_threads; a public.dm_assets; obj storage.objects; aid uuid; mid uuid; recipient uuid;
begin
 perform public.private_object_require_disabled('dm-media');
 select * into t from public.dm_threads where id=p_thread_id for update;
 if auth.uid() is null or t.id is null or auth.uid() not in (t.user_low,t.user_high) or
 (p_expected_sender_id is not null and p_expected_sender_id<>auth.uid()) then raise exception 'Thread unavailable; account changed' using errcode='42501';end if;
 if p_body is null or char_length(p_body)>4000 or p_asset_ids is null or cardinality(p_asset_ids)>4 or
 coalesce(array_ndims(p_asset_ids),1)<>1 or exists(select 1 from unnest(p_asset_ids) v(id) where id is null) or
 (select count(distinct id) from unnest(p_asset_ids) v(id))<>cardinality(p_asset_ids) or
 (char_length(btrim(p_body))=0 and cardinality(p_asset_ids)=0) then raise exception 'Invalid message body or images' using errcode='22023';end if;
 -- Object-before-registry locks match Storage deletion; deterministic asset
 -- ordering also serializes attempts to attach the same image to two threads.
 for aid in select id from unnest(p_asset_ids) v(id) order by id loop
  select * into a from public.dm_assets where id=aid and owner_id=auth.uid();
  if a.id is null then raise exception 'Asset unavailable' using errcode='42501';end if;
  select * into obj from storage.objects o where public.private_object_is_current(o) and id=a.storage_object_id and bucket_id='dm-media' for share;
  if obj.id is null then raise exception 'Asset unavailable' using errcode='42501';end if;
  perform 1 from public.dm_assets where id=aid for update;
  if not found or exists(select 1 from public.dm_message_assets where asset_id=aid) then raise exception 'Image already sent or unavailable' using errcode='22023';end if;
  if obj.name<>a.object_path or obj.metadata->>'mimetype' is distinct from a.mime_type or
    obj.metadata->>'size' is distinct from a.size_bytes::text then raise exception 'Image metadata changed' using errcode='22023';end if;
 end loop;
 recipient:=case when auth.uid()=t.user_low then t.user_high else t.user_low end;
 insert into public.dm_messages(thread_id,message_no,sender_id,body) values(t.id,t.last_no+1,auth.uid(),p_body) returning id into mid;
 insert into public.dm_message_assets(message_id,asset_id,position) select mid,id,(ordinality-1)::smallint from unnest(p_asset_ids) with ordinality v(id,ordinality);
 update public.dm_threads set last_no=t.last_no+1,last_message_at=clock_timestamp() where id=t.id;
 insert into public.notifications(user_id,actor_id,type,title,body,dm_thread_id,dm_message_id)
 values(recipient,auth.uid(),'direct_message','收到新私信','',t.id,mid);
 return mid;
end; $$;

create or replace function public.community_save_revision(p_item_id uuid,p_title text,p_body jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare item public.content_items; rid uuid; next_no integer; ids uuid[]; asset_id uuid; asset public.user_assets;
begin
 perform public.private_object_require_disabled('community-assets');
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
    perform 1 from storage.objects o where public.private_object_is_current(o) and id=asset.storage_object_id for share;
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

create or replace function public.community_import_legacy(p_owner uuid,p_type text,p_slug text,p_target_id text,p_source_sha256 text,p_title text,p_body jsonb,p_published_at timestamptz,p_featured boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid; r uuid; a uuid; ids uuid[]; existing public.community_legacy_mappings; kind text;
begin
 perform public.private_object_require_disabled('community-assets');
 kind:=case p_type when 'article' then 'post' else p_type end;
 if p_type not in ('article','moment','album') or p_type is null or p_published_at is null or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid legacy manifest' using errcode='22023';end if;
 if p_owner is distinct from (select legacy_author_id from public.community_publication_config where singleton) or p_owner is null then raise exception 'Configured legacy owner required' using errcode='42501';end if;
 perform public.community_cycle_lock(p_owner,p_type);
 select * into existing from public.community_legacy_mappings where target_type=kind and target_id=p_target_id;
 if found then
  if existing.source_sha256<>p_source_sha256 then raise exception 'Legacy source changed; operator review required' using errcode='22023';end if;
  return existing.item_id;
 end if;
 ids:=public.community_validate_body(p_type,p_body);
 if p_title is null or char_length(p_title) not between 1 and 160 or not exists(select 1 from public.profiles where id=p_owner) then raise exception 'Invalid legacy owner/title' using errcode='22023';end if;
 if exists(select 1 from public.content_items where content_type=p_type and slug=p_slug) then raise exception 'Legacy slug collision' using errcode='22023';end if;
 for a in select id from unnest(ids) id order by id loop
  if not exists(select 1 from public.user_assets where id=a and owner_id=p_owner and storage_object_id is not null and (p_type<>'album' or mime_type like 'image/%')) then raise exception 'Legacy asset unavailable' using errcode='42501';end if;
  perform 1 from storage.objects o join public.user_assets u on u.storage_object_id=o.id where u.id=a and public.private_object_is_current(o) for share of o;
  if not found then raise exception 'Legacy asset unavailable' using errcode='42501';end if;
 end loop;
 insert into public.content_items(author_id,content_type,slug,featured) values(p_owner,p_type,p_slug,p_type='article' and coalesce(p_featured,false)) returning id into i;
 insert into public.content_revisions(item_id,revision_no,title,body,status,submitted_at,resolved_at) values(i,1,p_title,p_body,'approved',p_published_at,p_published_at) returning id into r;
 insert into public.revision_assets(revision_id,asset_id) select r,id from unnest(ids) id;
 insert into public.content_reviews(item_id,revision_id,status,decision_source,policy_snapshot,resolved_at,review_outcome) values(i,r,'approved','admin',jsonb_build_object('legacy_import',true,'source_sha256',p_source_sha256),p_published_at,'approved');
 insert into public.community_legacy_mappings(item_id,target_type,target_id,source_sha256,published_at) values(i,kind,p_target_id,p_source_sha256,p_published_at);
 perform public.community_record_first_publication(i,r);
 update public.content_items set published_revision_id=r where id=i;
 insert into public.community_management_audit(action,item_id,revision_id,details) values('legacy_import',i,r,jsonb_build_object('target_type',kind,'target_id',p_target_id,'source_sha256',p_source_sha256));
 return i;
end; $$;

create or replace function public.private_object_guard_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare bucket text; obj storage.objects;
begin
 bucket:=case tg_table_name when 'dm_assets' then 'dm-media' else 'community-assets' end;
 perform public.private_object_require_disabled(bucket);
 select * into obj from storage.objects o where public.private_object_is_current(o) and id=new.storage_object_id and bucket_id=bucket and name=new.object_path for share;
 if obj.id is null or split_part(new.object_path,'/',1) is distinct from new.owner_id::text
  or obj.metadata->>'mimetype' is distinct from new.mime_type or obj.metadata->>'size' is distinct from new.size_bytes::text
  or (tg_table_name='user_assets' and to_jsonb(new)->>'bucket_id' is distinct from bucket)
  or not public.private_object_can_insert(bucket,new.object_path) then
  raise exception 'Object unavailable or reserved for deletion; upload under a new path' using errcode='23514';
 end if;
 if tg_op='UPDATE' and (new.storage_object_id is distinct from old.storage_object_id or new.object_path is distinct from old.object_path or new.owner_id is distinct from old.owner_id or new.mime_type is distinct from old.mime_type or new.size_bytes is distinct from old.size_bytes) then
  raise exception 'Registered asset identity is immutable' using errcode='23514';
 end if;
 return new;
end $$;

create or replace function public.private_object_prepare_delete(p_bucket text,p_asset uuid,p_object uuid) returns text
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; oid uuid; path text;
begin
 perform public.private_object_require_disabled(p_bucket);
 if auth.uid() is null or p_bucket not in ('dm-media','community-assets') or (p_asset is null)=(p_object is null) then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_asset is not null then
  if p_bucket='dm-media' then select storage_object_id into oid from public.dm_assets where id=p_asset and owner_id=auth.uid();
  else select storage_object_id into oid from public.user_assets where id=p_asset and owner_id=auth.uid();end if;
 else oid:=p_object;end if;
 -- Same object-first ordering as send/registration and actual Storage deletion.
 select * into obj from storage.objects o where public.private_object_is_current(o) and id=oid and bucket_id=p_bucket and split_part(name,'/',1)=auth.uid()::text for update;
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

create or replace function public.private_object_finish_deletes() returns integer language plpgsql security definer set search_path='' as $$
declare n integer; total integer;
begin
 perform public.private_object_require_disabled('dm-media');
 perform public.private_object_require_disabled('community-assets');
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 delete from public.dm_asset_delete_intents d where owner_id=auth.uid() and not exists(select 1 from storage.objects o where public.private_object_is_current(o) and o.bucket_id='dm-media' and o.name=d.object_path);get diagnostics total=row_count;
 delete from public.community_asset_delete_intents d where owner_id=auth.uid() and not exists(select 1 from storage.objects o where public.private_object_is_current(o) and o.bucket_id='community-assets' and o.name=d.object_path);get diagnostics n=row_count;
 return total+n;
end $$;

create or replace function public.dm_clear_delete_intent() returns trigger language plpgsql security definer set search_path='' as $$
begin return old;end $$;
revoke all on function public.dm_clear_delete_intent() from public,anon,authenticated;

create or replace function public.community_clear_delete_intent() returns trigger language plpgsql security definer set search_path='' as $$
begin return old;end $$;
revoke all on function public.community_clear_delete_intent() from public,anon,authenticated;
