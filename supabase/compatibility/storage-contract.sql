-- Read-only fail-closed Storage contract. This fragment also runs in preflight.
do $storage_contract$
declare version_columns integer; versioned boolean; path_unique boolean;
begin
 if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
  raise exception 'Storage contract: managed tables missing';
 end if;
 select count(*) into version_columns from pg_attribute where attrelid='storage.objects'::regclass
 and attname in ('archived_at','is_delete_marker','is_versioned') and not attisdropped;
 versioned:=version_columns=3;
 if version_columns not in (0,3) then raise exception 'Storage contract: partial versioning schema';end if;
 if versioned and (
  not exists(select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='archived_at' and atttypid='timestamptz'::regtype and not attisdropped)
  or (select count(*) from pg_attribute where attrelid='storage.objects'::regclass and attname in ('is_delete_marker','is_versioned') and atttypid='boolean'::regtype and attnotnull and not attisdropped)<>2
  or not exists(select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='version' and atttypid='text'::regtype and not attisdropped)
  or not exists(select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='versioning_status' and atttypid='text'::regtype and attnotnull and not attisdropped)
 ) then raise exception 'Storage contract: unsupported versioning column definitions';end if;
 if not versioned and exists(select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='versioning_status' and not attisdropped) then
  raise exception 'Storage contract: bucket/object versioning schema mismatch';end if;
 -- Accept a native, immediate btree uniqueness guarantee over EXACTLY the two
 -- plain keys, including the official C collation. Never trust an index name.
 -- The current-row index includes delete markers: two current rows of any kind
 -- must conflict. A predicate excluding markers or only one bucket is unsafe.
 select exists(select 1 from pg_index x join pg_class i on i.oid=x.indexrelid
 join pg_am am on am.oid=i.relam where x.indrelid='storage.objects'::regclass
 and x.indisunique and x.indisvalid and x.indisready and x.indimmediate
 and am.amname='btree' and x.indexprs is null and x.indnkeyatts=2
 and (select array_agg(a.attname::text order by a.attname) from unnest(x.indkey::smallint[]) with ordinality k(n,p)
  join pg_attribute a on a.attrelid=x.indrelid and a.attnum=k.n where k.p<=x.indnkeyatts)=array['bucket_id','name']
 -- pg_get_indexdef prints a non-default opclass explicitly. This strict key
 -- allow-list accepts only default text operators and default/C collation,
 -- without requiring direct access to pg_opclass on restricted SQL roles.
 and not exists(select 1 from generate_series(1,2) k(n) where pg_get_indexdef(x.indexrelid,k.n,false)
  not in ('bucket_id','name','bucket_id COLLATE "C"','name COLLATE "C"'))
 and (select count(*) from pg_attribute a where a.attrelid=x.indrelid and a.attname in ('bucket_id','name')
  and a.atttypid='text'::regtype and not a.attisdropped)=2
 and not exists(select 1 from unnest(x.indcollation::oid[]) co(oid) join pg_collation c on c.oid=co.oid where not c.collisdeterministic)
 and (x.indpred is null or (versioned and regexp_replace(lower(pg_get_expr(x.indpred,x.indrelid)),'[()[:space:]]','','g')='archived_atisnull')))
 into path_unique;
 if not path_unique then
  raise exception 'Storage contract: no valid immediate native uniqueness for (bucket_id,name) current rows; STOP, never add a managed index';end if;
 if exists(select 1 from pg_attribute a join pg_collation c on c.oid=a.attcollation
  where a.attrelid='storage.objects'::regclass and a.attname in ('bucket_id','name') and not c.collisdeterministic) then
  raise exception 'Storage contract: unsupported nondeterministic path comparison';end if;
 if (select count(*) from storage.buckets b where id in ('dm-media','community-assets') and public=false
  and (not versioned or to_jsonb(b)->>'versioning_status'='DISABLED'))<>2 then
  raise exception 'Storage contract: both private buckets must exist and remain DISABLED';end if;
 if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
  raise exception 'Storage contract: objects RLS disabled';end if;
end $storage_contract$;
