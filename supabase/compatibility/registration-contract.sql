-- READ ONLY. Runs after the catalog and Storage shape checks, before any DDL.
-- Do not call newly installed helpers: candidate boundary 22 has none of them.
do $registration_contract$
begin
 if exists(select 1 from (
  select 'dm-media' bucket_id,storage_object_id,object_path,owner_id,mime_type,size_bytes from public.dm_assets
  union all select bucket_id,storage_object_id,object_path,owner_id,mime_type,size_bytes from public.user_assets
 ) a left join storage.objects o on o.id=a.storage_object_id
 where o.id is null or to_jsonb(o)->>'archived_at' is not null
 or (to_jsonb(o) ? 'is_delete_marker' and to_jsonb(o)->>'is_delete_marker' is distinct from 'false')
 or o.bucket_id is distinct from a.bucket_id or o.name is distinct from a.object_path
 or split_part(a.object_path,'/',1) is distinct from a.owner_id::text
 or (to_jsonb(o)->>'owner_id' is not null and to_jsonb(o)->>'owner_id' is distinct from a.owner_id::text)
 or (to_jsonb(o)->>'owner' is not null and to_jsonb(o)->>'owner' is distinct from a.owner_id::text)
 or o.metadata->>'mimetype' is distinct from a.mime_type or o.metadata->>'size' is distinct from a.size_bytes::text) then
  raise exception 'Storage contract: existing registry/object mismatch (current state, owner, bucket, path or metadata); STOP and preserve data';end if;
 if to_regclass('public.private_object_tombstones') is null
  and (exists(select 1 from public.dm_asset_delete_intents) or exists(select 1 from public.community_asset_delete_intents)) then
  raise exception 'Pending historical deletion intents; STOP and reconcile in an isolated backup before upgrade';end if;
end $registration_contract$;
