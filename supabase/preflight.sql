-- READ ONLY. No message bodies, keys, tokens, or auth credentials.
begin transaction read only;
select current_user as sql_role,session_user,current_database();
select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='storage' and c.relname in ('objects','buckets')) or (n.nspname='public' and c.relkind='r');
select indexname,indexdef from pg_indexes where schemaname='storage' and tablename='objects';
-- Index names alone do not establish safety. Save predicates/keys and validity.
select i.indexrelid::regclass as index_name,i.indisunique,i.indisvalid,i.indisready,i.indimmediate,
 i.indnkeyatts,pg_get_expr(i.indpred,i.indrelid) as predicate,pg_get_indexdef(i.indexrelid) as definition
from pg_index i where i.indrelid=to_regclass('storage.objects');
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='storage' and table_name in ('objects','buckets') order by table_name,ordinal_position;
select c.conrelid::regclass as table_name,c.conname,c.convalidated,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.connamespace='public'::regnamespace order by 1,2;
select table_schema,table_name,column_name,data_type,is_nullable from information_schema.columns
where table_schema='public' and (table_name like 'dm_%' or table_name like 'community_%' or table_name like 'content_%' or table_name in ('private_object_tombstones','user_assets')) order by 2,ordinal_position;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 2,3;
select c.oid::regclass as table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) order by 1,2;
select * from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;
select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema in ('public','storage') and grantee in ('anon','authenticated','service_role') order by 1,2,3,4;
select to_regclass('supabase_migrations.schema_migrations') as migration_history_table,
 to_regclass('public.dm_threads') as dm_installation,to_regclass('public.community_legacy_mappings') as legacy_bridge,
 to_regclass('public.private_object_tombstones') as storage_repair,to_regprocedure('public.community_release_preflight()') as release_contract,
 to_regclass('public.community_article_preferences') as article_preferences,
 to_regprocedure('public.community_save_featured_preference(uuid,boolean)') as featured_draft_rpc,
 to_regprocedure('public.community_submit_featured_article(uuid)') as atomic_featured_rpc,
 to_regprocedure('public.profile_search(text,integer,integer)') as public_profile_search_rpc;
-- Storage is expected to exist in every hosted project; stop if these fail.
select id,public,file_size_limit,allowed_mime_types,to_jsonb(b)->>'versioning_status' as versioning_status
from storage.buckets b where id in ('dm-media','community-assets','published-media','avatars') order by id;
-- Aggregate metadata only: no names, private paths or message bodies.
select bucket_id,count(*) as total_records,
 count(*) filter(where to_jsonb(o)->>'archived_at' is not null) as archived_records,
 count(*) filter(where to_jsonb(o)->>'is_delete_marker'='true') as delete_markers,
 count(*) filter(where to_jsonb(o)->>'archived_at' is null and coalesce(to_jsonb(o)->>'is_delete_marker','false')='false') as current_files
from storage.objects o where bucket_id in ('dm-media','community-assets') group by bucket_id;
select to_regprocedure('public.private_object_is_current(storage.objects)') as current_object_repair,
 to_regprocedure('public.private_object_matches_owner(storage.objects,uuid)') as owner_consistency_repair;
-- For a candidate boundary 22 also run generated diagnose-boundary-22.sql.
-- Only that exact catalog/Storage check permits the compatible migration 23.
-- Check maps/settings counts only if the tables exist: use the separate postflight after installation.
do $$declare versions jsonb; mapped bigint;begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
  execute 'select jsonb_agg(version order by version) from supabase_migrations.schema_migrations' into versions;
  raise notice 'Recorded migration versions (verify actual objects too): %',versions;
 end if;
 if to_regclass('public.community_legacy_mappings') is not null then
  execute 'select count(*) from public.community_legacy_mappings' into mapped;
  raise notice 'Existing legacy mappings: %',mapped;
 end if;
end$$;
rollback;
