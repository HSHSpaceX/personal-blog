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
