// Deterministic compatibility overlays. Historical SQL is never edited or replayed.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');
const hash=s=>createHash('sha256').update(s).digest('hex');
const reference=JSON.parse(read('supabase/compatibility/boundaries.json'));
let previous={};
for(const [boundary,delta] of Object.entries(reference.boundaries)){
 previous={...previous,...delta};for(const key of Object.keys(previous))if(previous[key]===null)delete previous[key];
 reference.boundaries[boundary]={...previous};
}
export const storageSources=Object.entries(reference.sources).map(([file,sha256])=>({file,sha256}));
function Storage_ReadHistory(name){
 const sql=read('supabase/migrations/'+name);
 if(hash(sql)!==reference.sources[name])throw Error('Historical SQL checksum changed: '+name);
 return sql;
}
function Storage_Replace(sql,from,to){
 if(!sql.includes(from)||sql.indexOf(from)!==sql.lastIndexOf(from))throw Error('Expected one reviewed SQL fragment: '+from);
 return sql.replace(from,()=>to);
}
function Storage_Function(file,name){
 const sql=Storage_ReadHistory(file),match=sql.match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'));
 if(!match)throw Error('Missing reviewed function '+name);
 return match[0].replace(/^create function/,'create or replace function');
}
const migration23='202610130001_storage_compatibility.sql';
const dm='202610070002_direct_messages.sql',media='202610110002_private_media_and_legacy_bridge.sql';
const resource='202610060008_resource_center.sql';
const current='public.private_object_is_current(o)';
function Storage_Filter(sql){
 return sql.replaceAll('from storage.objects where','from storage.objects o where '+current+' and')
  .replaceAll('from storage.objects o where o.', 'from storage.objects o where '+current+' and o.');
}
function Storage_Disabled(sql,bucket){
 return Storage_Replace(sql,'\nbegin\n','\nbegin\n perform public.private_object_require_disabled('+bucket+');\n');
}
export function Storage_Runtime(){
 let sql=read('supabase/compatibility/current-object-helpers.sql');
 for(const [file,name,bucket] of [
  [dm,'dm_register_asset',"'dm-media'"],[media,'community_register_asset',"'community-assets'"],
  [media,'community_register_legacy_asset',"'community-assets'"],
  [dm,'dm_orphan_assets',"'dm-media'"],[resource,'community_orphan_assets',"'community-assets'"],
  [dm,'dm_send_message',"'dm-media'"],
  ['202610060004_private_assets.sql','community_save_revision',"'community-assets'"],
  [media,'community_import_legacy',"'community-assets'"],
  [migration23,'private_object_guard_registration',null],
  [migration23,'private_object_prepare_delete','p_bucket'],[migration23,'private_object_finish_deletes',"'dm-media'"]
 ]){
  let fn=Storage_Filter(Storage_Function(file,name));
  if(bucket)fn=Storage_Disabled(fn,bucket);
  if(name==='community_import_legacy')fn=Storage_Replace(fn,'where u.id=a for share of o;','where u.id=a and '+current+' for share of o;\n  if not found then raise exception \'Legacy asset unavailable\' using errcode=\'42501\';end if;');
  if(name==='community_register_legacy_asset')fn=Storage_Replace(fn,'if found then return asset_id;end if;',`if found then
  if not exists(select 1 from public.user_assets where id=asset_id and owner_id=p_owner and bucket_id='community-assets'
   and object_path=p_path and mime_type=p_mime and size_bytes=p_size)
   or not public.private_object_can_insert('community-assets',p_path) then
   raise exception 'Legacy registry mismatch or reserved for deletion' using errcode='23514';end if;
  return asset_id;end if;`);
  if(name==='private_object_guard_registration'){
   fn=Storage_Replace(fn,'declare bucket text;','declare bucket text; obj storage.objects;');
   fn=Storage_Replace(fn," perform 1 from storage.objects o where "+current+" and id=new.storage_object_id and bucket_id=bucket and name=new.object_path for share;",
    " perform public.private_object_require_disabled(bucket);\n select * into obj from storage.objects o where "+current+" and id=new.storage_object_id and bucket_id=bucket and name=new.object_path for share;");
   fn=Storage_Replace(fn,' if not found or not public.private_object_can_insert(bucket,new.object_path) then',` if obj.id is null or split_part(new.object_path,'/',1) is distinct from new.owner_id::text
  or obj.metadata->>'mimetype' is distinct from new.mime_type or obj.metadata->>'size' is distinct from new.size_bytes::text
  or (tg_table_name='user_assets' and to_jsonb(new)->>'bucket_id' is distinct from bucket)
  or not public.private_object_can_insert(bucket,new.object_path) then`);
  }
  if(name==='private_object_finish_deletes')fn=Storage_Replace(fn," perform public.private_object_require_disabled('dm-media');"," perform public.private_object_require_disabled('dm-media');\n perform public.private_object_require_disabled('community-assets');");
  sql+='\n'+fn+'\n';
 }
 // Old installations can retain their managed triggers, but those triggers must
 // not clear a path intent when Storage deletes an unrelated historical row.
 for(const name of ['dm_clear_delete_intent','community_clear_delete_intent'])sql+=`
create or replace function public.${name}() returns trigger language plpgsql security definer set search_path='' as $$
begin return old;end $$;
revoke all on function public.${name}() from public,anon,authenticated;
`;
 return sql;
}
export function Storage_BoundaryGuard(boundaries=[22]){
 for(const {file} of storageSources)Storage_ReadHistory(file);
 const query=read('supabase/compatibility/boundary-inventory.sql').trim().replace(/;$/,'');
 const expected=Object.fromEntries(boundaries.map(n=>[n,reference.boundaries[n]]));
 return `do $boundary$
declare actual jsonb; expected jsonb:=$expected$${JSON.stringify(expected)}$expected$::jsonb; matched text; differences jsonb;
begin
 perform pg_catalog.set_config('search_path','pg_catalog,public',true);
 select jsonb_object_agg(key,digest) into actual from (${query}) inventory;
 select key into matched from jsonb_each(expected) where value=actual;
 if matched is null then
  select jsonb_object_agg(boundary,missing) into differences from (
   select e.key boundary,(select jsonb_agg(k order by k) from
    (select key k from jsonb_each(e.value) union select key from jsonb_each(coalesce(actual,'{}'))) keys
    where e.value->k is distinct from actual->k) missing from jsonb_each(expected) e) delta;
  raise exception 'Incomplete installation or unexpected boundary; STOP. Run boundary diagnostic. Differences: %',differences;
 end if;
 if (select count(*) from public.review_policies where content_type in ('article','moment','album'))<>3
  or (select count(*) from public.community_publication_config where singleton)<>1
  or not exists(select 1 from public.community_management_audit where action='period_policy_migration')
  or exists(select 1 from public.content_items i where exists(select 1 from public.content_revisions r where r.item_id=i.id and r.status='approved')
   and not exists(select 1 from public.content_first_publications f where f.item_id=i.id)) then
  raise exception 'Incomplete installation data invariants; STOP and inspect seed/backfill execution evidence';end if;
 raise notice 'Verified historical application boundary: % (original or trimmed managed triggers)',matched;
end $boundary$;\n`;
}
export function Storage_Contract(){return read('supabase/compatibility/storage-contract.sql');}
export function Storage_Transform23(source){
 if(hash(source)!==reference.sources[migration23])throw Error('Historical SQL checksum changed: '+migration23);
 const start=source.indexOf(' if not exists(select 1 from pg_index x'),end=source.indexOf(" if not exists(select 1 from pg_constraint",start);
 if(start<0||end<0)throw Error('Historical Storage guard changed');
 let sql=source.slice(0,start)+' -- Native current-row uniqueness checked by the compatibility contract.\n'+source.slice(end);
 sql=Storage_Replace(sql,'begin;','begin;\nset local lock_timeout=\'10s\';\n'+Storage_BoundaryGuard()+Storage_Contract());
 // A pending old deletion still has its registry attached. Never guess whether
 // that operation is safe to resume under new semantics.
 sql=Storage_Replace(sql,'-- Registered objects cannot disappear',`do $$begin
 if exists(select 1 from public.dm_asset_delete_intents) or exists(select 1 from public.community_asset_delete_intents) then
  raise exception 'Pending historical deletion intents; STOP and reconcile in an isolated backup before upgrade';end if;
end $$;
-- Registered objects cannot disappear`);
 return Storage_Replace(sql,'commit;',Storage_Runtime()+'\ncommit;');
}
export function Storage_ForwardRepair(){
 return '-- ONLY a verified, UNPATCHED historical boundary 23..27. Never run after the compatible migration 23.\nbegin;\nset local lock_timeout=\'10s\';\n'
  +Storage_BoundaryGuard([23,24,25,26,27])+Storage_Contract()+Storage_Runtime()+'\ncommit;\n';
}
