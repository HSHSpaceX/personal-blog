-- Catalog only. No user rows, credentials, ownership changes or writes.
-- Stable keys and normalized definitions; extra extension objects are ignored.
with app_tables as (
 select c.* from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
 and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
), inventory as (
 select 'table:'||c.relname as key, jsonb_build_array(c.relrowsecurity,c.relforcerowsecurity,
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
    pg_get_expr(v.adbin,v.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef v on v.adrelid=a.attrelid and v.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))::text as definition from app_tables c
 union all
 select 'constraint:'||c.relname||':'||x.conname,pg_get_constraintdef(x.oid)||':'||x.convalidated
 from pg_constraint x join app_tables c on c.oid=x.conrelid where x.contype<>'n'
 union all
 select 'index:'||c.relname||':'||i.relname,pg_get_indexdef(x.indexrelid)||':'||x.indisvalid||':'||x.indisready
 from pg_index x join app_tables c on c.oid=x.indrelid join pg_class i on i.oid=x.indexrelid
 union all
 select 'function:'||p.oid::regprocedure::text,jsonb_build_array(l.lanname,p.prosecdef,p.provolatile,p.proconfig,
   pg_get_function_result(p.oid),p.prosrc,pg_get_expr(p.proargdefaults,0))::text
 from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace
 and not exists(select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e')
 union all
 select 'trigger:'||c.relname||':'||t.tgname,pg_get_triggerdef(t.oid)||':'||t.tgenabled::text
 from pg_trigger t join app_tables c on c.oid=t.tgrelid where not t.tgisinternal
 union all
 select 'auth_trigger:'||t.tgname,pg_get_triggerdef(t.oid)||':'||t.tgenabled::text
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid=to_regclass('auth.users') and not t.tgisinternal and p.pronamespace='public'::regnamespace
 union all
 select 'policy:'||schemaname||'.'||tablename||':'||policyname,
 jsonb_build_array(permissive,roles,cmd,qual,with_check)::text from pg_policies
 where schemaname='public' or (schemaname='storage' and tablename='objects')
 union all
 select 'table_acl:'||c.relname||':'||r.name,
 jsonb_build_array(has_table_privilege(r.name,c.oid,'SELECT'),has_table_privilege(r.name,c.oid,'INSERT'),
 has_table_privilege(r.name,c.oid,'UPDATE'),has_table_privilege(r.name,c.oid,'DELETE'),
 has_table_privilege(r.name,c.oid,'TRUNCATE'),has_table_privilege(r.name,c.oid,'REFERENCES'),has_table_privilege(r.name,c.oid,'TRIGGER'),
 (select jsonb_agg(jsonb_build_array(a.attname,has_column_privilege(r.name,c.oid,a.attnum,'SELECT'),
 has_column_privilege(r.name,c.oid,a.attnum,'INSERT'),has_column_privilege(r.name,c.oid,a.attnum,'UPDATE'),
 has_column_privilege(r.name,c.oid,a.attnum,'REFERENCES')) order by a.attnum)
 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))::text
 from app_tables c cross join (values('anon'),('authenticated')) r(name)
 union all
 select 'function_acl:'||p.oid::regprocedure::text,
 jsonb_build_array(has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))::text
 from pg_proc p where p.pronamespace='public'::regnamespace
 and not exists(select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e')
)
select key,md5(regexp_replace(replace(definition,E'\\r',''),'[[:space:]]+',' ','g')) as digest from inventory order by key
