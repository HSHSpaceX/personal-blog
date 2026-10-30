-- Application-owned helpers only. The installer validates the table shape first.
create or replace function public.private_object_is_current(p_object storage.objects) returns boolean
language sql immutable set search_path='' as $$
 select p_object.id is not null and case when to_jsonb(p_object) ? 'archived_at' then
  to_jsonb(p_object)->>'archived_at' is null and to_jsonb(p_object)->>'is_delete_marker'='false'
  else true end;
$$;
revoke all on function public.private_object_is_current(storage.objects) from public,anon,authenticated;

create or replace function public.private_object_require_disabled(p_bucket text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_bucket is null or p_bucket not in ('dm-media','community-assets') or not exists(
  select 1 from storage.buckets b where b.id=p_bucket and b.public=false
  and (not (to_jsonb(b) ? 'versioning_status') or to_jsonb(b)->>'versioning_status'='DISABLED')) then
  raise exception 'Private bucket must remain DISABLED' using errcode='23514';end if;
end $$;
revoke all on function public.private_object_require_disabled(text) from public,anon,authenticated;

-- Service-key/Dashboard uploads legitimately have no native owner (Supabase
-- Ownership documentation). Path + existing RPC/RLS authorization remain
-- mandatory in that case. A supplied owner must never contradict the registry.
-- JSON access also supports legacy schemas without one of the owner columns.
create function public.private_object_matches_owner(p_object storage.objects,p_owner uuid) returns boolean
language sql immutable set search_path='' as $$
 select p_owner is not null and p_object.id is not null
  and split_part(p_object.name,'/',1)=p_owner::text
  and (to_jsonb(p_object)->>'owner_id' is null or to_jsonb(p_object)->>'owner_id'=p_owner::text)
  and (to_jsonb(p_object)->>'owner' is null or to_jsonb(p_object)->>'owner'=p_owner::text);
$$;
revoke all on function public.private_object_matches_owner(storage.objects,uuid) from public,anon,authenticated;
