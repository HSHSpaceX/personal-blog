-- Read-only diagnostics, including empty/partially upgraded databases.
-- The transaction-local setting carries the report; ROLLBACK discards it.
-- Object evidence is not proof that an entire migration was committed.
begin transaction read only;
do $$
declare
 report jsonb; capabilities jsonb; release jsonb; errors jsonb:='{}'; counts jsonb:='{}';
 missing_tables text[]:='{}'; missing_functions text[]:='{}'; issues text[]:='{}';
 name text; signature text; fn oid; prefs oid; present integer:=0; amount bigint;
 base_ready boolean; round2_state text; source text; storage_report jsonb:='{}';
begin
 foreach name in array array['profiles','user_roles','notifications','content_items','content_revisions',
  'content_reviews','content_review_cycles','content_first_publications','content_revision_trash',
  'user_assets','revision_assets','community_publication_state','community_publication_config',
  'community_legacy_mappings','community_site_settings','dm_threads','dm_messages','dm_assets',
  'dm_message_assets','private_object_tombstones'] loop
  if to_regclass('public.'||name) is null then missing_tables:=array_append(missing_tables,name);end if;
 end loop;
 foreach signature in array array['community_capabilities()','community_release_preflight()',
  'community_create_draft(text,text,text,jsonb)','community_review_entry(text,uuid,text,text,text)',
  'community_review_queue(text,text,text,boolean,integer,integer)','community_create_album(text,text)',
  'community_delete_moment(uuid)','community_deleted_export()','private_object_finish_deletes()',
  'community_publication_export()','community_site_settings_export()'] loop
  if to_regprocedure('public.'||signature) is null then missing_functions:=array_append(missing_functions,signature);end if;
 end loop;
 if to_regprocedure('public.community_capabilities()') is not null then
  begin execute 'select public.community_capabilities()' into capabilities;
  exception when others then errors:=errors||jsonb_build_object('capabilities_sqlstate',sqlstate);end;
 end if;
 if to_regprocedure('public.community_release_preflight()') is not null then
  begin execute 'select public.community_release_preflight()' into release;
  exception when others then errors:=errors||jsonb_build_object('release_sqlstate',sqlstate);end;
 end if;
 base_ready:=cardinality(missing_tables)=0 and cardinality(missing_functions)=0
  and coalesce(capabilities->>'version','')='20261013' and coalesce(release->>'version','')='20261013';
 prefs:=to_regclass('public.community_article_preferences');
 if prefs is not null then
  present:=present+1;
  if not (select relrowsecurity from pg_class where oid=prefs) then issues:=array_append(issues,'preferences RLS missing');end if;
  if (select count(*) from pg_attribute where attrelid=prefs and not attisdropped and attname in ('revision_id','featured','applied_at'))<>3
   or not exists(select 1 from pg_constraint where conrelid=prefs and contype='p')
   or not exists(select 1 from pg_constraint where conrelid=prefs and contype='f' and confrelid=to_regclass('public.content_revisions') and confdeltype='r' and convalidated)
   then issues:=array_append(issues,'preferences structure incomplete');end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='community_article_preferences'
   and policyname='article_preferences_owner_admin' and cmd='SELECT' and qual like '%is_admin()%'
   and qual like '%author_id = auth.uid()%') then issues:=array_append(issues,'preferences owner/admin policy missing');end if;
  if not has_table_privilege('authenticated',prefs,'SELECT') or has_table_privilege('authenticated',prefs,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_table_privilege('anon',prefs,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   then issues:=array_append(issues,'preferences privileges unexpected');end if;
 end if;
 foreach signature in array array['community_save_featured_preference(uuid,boolean)','community_submit_featured_article(uuid)','profile_search(text,integer,integer)'] loop
  fn:=to_regprocedure('public.'||signature);
  if fn is null then issues:=array_append(issues,'missing '||signature);continue;end if;
  present:=present+1;
  if not exists(select 1 from pg_proc where oid=fn and prosecdef and 'search_path=""'=any(proconfig))
   or not has_function_privilege('authenticated',fn,'EXECUTE')
   or has_function_privilege('anon',fn,'EXECUTE')<>(signature='profile_search(text,integer,integer)')
   or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE')
   then issues:=array_append(issues,'RPC security unexpected: '||signature);end if;
 end loop;
 fn:=to_regprocedure('public.community_set_featured(uuid,boolean)');
 if fn is not null then
  select prosrc into source from pg_proc where oid=fn;
  if present>0 and (position('left(article_title,160)' in source)=0 or position('r.status=''approved''' in source)=0)
   then issues:=array_append(issues,'featured notification function is not upgraded');end if;
 elsif present>0 then issues:=array_append(issues,'featured function missing');end if;
 round2_state:=case when present=0 then 'missing' when present=4 and cardinality(issues)=0 and base_ready then 'ready' else 'incomplete' end;
 foreach name in array array['community_legacy_mappings','community_site_settings','private_object_tombstones','dm_asset_delete_intents','community_asset_delete_intents'] loop
  if to_regclass('public.'||name) is not null then
   begin execute format('select count(*) from public.%I',name) into amount;counts:=counts||jsonb_build_object(name,amount);
   exception when others then errors:=errors||jsonb_build_object(name||'_sqlstate',sqlstate);end;
  end if;
 end loop;
 -- Keep partial installations diagnosable; this evidence is NOT an automatic
 -- installation boundary or a substitute for the strict generated contract.
 if to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null then
  begin
   execute $q$select jsonb_build_object(
    'current_object_helper',to_regprocedure('public.private_object_is_current(storage.objects)') is not null,
    'owner_consistency_helper',to_regprocedure('public.private_object_matches_owner(storage.objects,uuid)') is not null,
    'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public,'versioning_status',to_jsonb(b)->>'versioning_status') order by id)
      from storage.buckets b where id in ('dm-media','community-assets')),
    'archived_records',(select count(*) from storage.objects o where bucket_id in ('dm-media','community-assets') and to_jsonb(o)->>'archived_at' is not null),
    'delete_markers',(select count(*) from storage.objects o where bucket_id in ('dm-media','community-assets') and to_jsonb(o)->>'is_delete_marker'='true'),
    'action','For candidate boundary 22 run generated diagnose-boundary-22.sql; inspect indexes in preflight. DISABLED does not exclude history.')$q$ into storage_report;
  exception when others then errors:=errors||jsonb_build_object('storage_sqlstate',sqlstate);end;
 end if;
 report:=jsonb_build_object('storage',storage_report,'base_state',case when base_ready then 'ready' when to_regclass('public.content_items') is null and to_regclass('public.dm_threads') is null then 'not_installed' else 'incomplete' end,
  'round2_state',round2_state,'missing_tables',missing_tables,'missing_functions',missing_functions,
  'round2_issues',issues,'capabilities',capabilities,'release',release,'counts',counts,'diagnostic_errors',errors,
  'operator_action',case when base_ready and round2_state='ready' then 'Compare full preflight and migration history, then run real Auth/Storage acceptance.'
   when base_ready and round2_state='missing' then 'Verify the complete boundary through migration 26; apply migration 27 once only.'
   else 'STOP. Inspect the complete object inventory and backup; do not replay an uncertain migration.' end);
 perform set_config('community.operator_diagnostics',report::text,true);
end $$;
select current_setting('community.operator_diagnostics')::jsonb as installation_status;
select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
 ('community_capabilities','community_release_preflight','community_save_featured_preference','community_submit_featured_article','community_set_featured','profile_search') order by 1;
select to_regclass('supabase_migrations.schema_migrations') as cli_history_table;
rollback;
