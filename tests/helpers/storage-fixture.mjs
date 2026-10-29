// Critical schema from supabase/storage 94e9900d227fb152ad3e66d14cf0a6d3e1901c49:
// tenant migrations 0062, 0065, 0066, 0067, 0071, 0072 (PostgreSQL >= 15).
// These are fixture DDL, NEVER production migration instructions.
export const versionedStorageSQL=`
 alter table storage.objects drop constraint objects_bucket_id_name_key;
 alter table storage.buckets add column versioning_status text not null default 'DISABLED'
  check(versioning_status in ('DISABLED','ENABLED','SUSPENDED'));
 alter table storage.objects add column version text, add column archived_at timestamptz,
  add column is_delete_marker boolean not null default false,
  add column is_versioned boolean not null default false;
 create unique index objects_bucket_id_name_version_key on storage.objects(bucket_id,name collate "C",version) nulls not distinct;
 create unique index idx_objects_current_version on storage.objects(bucket_id,name collate "C") where archived_at is null;
 create unique index idx_objects_null_version on storage.objects(bucket_id,name collate "C") where not is_versioned;
 create index idx_objects_delete_markers on storage.objects(bucket_id,name collate "C") where is_delete_marker;
`;
