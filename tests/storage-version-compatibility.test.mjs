import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDatabase,modulePath,seedActors,asActor,actors} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {versionedStorageSQL} from './helpers/storage-fixture.mjs';
import {Install_Build,Install_Transform} from '../scripts/build-compatible-install.mjs';
import {Storage_BoundaryGuard,Storage_ForwardRepair,Storage_Contract} from '../scripts/storage-compatibility.mjs';
const file='202610130001_storage_compatibility.sql';
const original=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const upgrade=Install_Transform(file,original);
const run=(db,who,sql,args=[])=>asActor(db,who?'authenticated':'anon',who,sql,args);
const {user,other,admin}=actors;
async function Storage_Object(db,bucket,options={}){
 const name=options.name||user+'/'+randomUUID()+'.png';
 return (await db.query(`insert into storage.objects(bucket_id,name,metadata,version,archived_at,is_delete_marker,is_versioned)
 values($1,$2,'{"mimetype":"image/png","size":10}',$3,$4,$5,$6) returning id,name`,
 [bucket,name,randomUUID(),options.archive?'2020-01-01':null,!!options.marker,!!options.archive])).rows[0];
}
for(const [engine,create,enabled] of [['PGlite',createDatabase,!!modulePath],['PostgreSQL',createNativeDatabase,nativeConfigured]]){
 for(const state of ['original','trimmed','fresh'])test(engine+' versioned Storage: '+state+' upgrade, current objects and private references',{skip:!enabled},async()=>{
  const db=await create(state==='fresh'?{storage:'versioned',compatible:true}:{through:'202610110004_idempotent_messages.sql',compatible:state==='trimmed'});
  try{
   if(state!=='fresh'){
    if(state==='original')await db.exec('drop index storage.dm_media_object_path'); // Simulate platform schema evolution in this isolated fixture only.
    await db.exec(versionedStorageSQL);
    if(state==='trimmed')await db.exec('alter index storage.idx_objects_current_version rename to arbitrary_current_uniqueness');
    await db.exec('begin read only;'+Storage_BoundaryGuard()+Storage_Contract()+'rollback;');
    await db.exec(upgrade);
    for(const name of ['202610130002_release_contract.sql','202610130003_review_queue.sql','202610130004_moment_deletion.sql','202610180001_article_settings_and_profile_search.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
   }
   await seedActors(db);
   for(const [bucket,prefix] of [['dm-media','dm'],['community-assets','community']]){
    const archived=await Storage_Object(db,bucket,{archive:true}),marker=await Storage_Object(db,bucket,{marker:true});
    for(const o of [archived,marker]){
     await assert.rejects(run(db,user,'select '+prefix+'_register_asset($1,$2)',[o.name,'image.png']),/Upload|upload|unavailable/);
     await assert.rejects(run(db,user,'select '+prefix+'_prepare_orphan_delete($1)',[o.id]),/unavailable/);
    }
    const current=await Storage_Object(db,bucket,{name:archived.name});
    const visible=(await run(db,user,'select * from '+prefix+'_orphan_assets()')).rows;
    assert.ok(visible.some(r=>r.object_id===current.id));assert.ok(!visible.some(r=>[archived.id,marker.id].includes(r.object_id)));
    for(const who of [other,admin,null]){
     await assert.rejects(run(db,who,'select '+prefix+'_register_asset($1,$2)',[current.name,'image.png']));
     await assert.rejects(run(db,who,'select '+prefix+'_prepare_orphan_delete($1)',[current.id]));
     assert.equal((await run(db,who,'select id from storage.objects where id=$1',[current.id])).rows.length,0);
    }
    const aid=(await run(db,user,'select '+prefix+'_register_asset($1,$2) id',[current.name,'image.png'])).rows[0].id;
    const table=prefix==='dm'?'dm_assets':'user_assets';
    assert.equal((await db.query('select storage_object_id from '+table+' where id=$1',[aid])).rows[0].storage_object_id,current.id);
    if(prefix==='dm'){
     const tid=(await run(db,user,'select dm_get_or_create_thread($1) id',[other])).rows[0].id;
     await run(db,user,'select dm_send_message($1,$2,$3)',[tid,'protected',[aid]]);
     await assert.rejects(run(db,user,'select dm_prepare_asset_delete($1)',[aid]),/cannot be deleted/);
     assert.equal((await run(db,other,'select id from storage.objects where id=$1',[current.id])).rows.length,1);
    }else{
     const item=(await run(db,user,"select community_create_item('article',$1) id",['history-'+randomUUID()])).rows[0].id;
     await run(db,user,'select community_save_revision($1,$2,$3)',[item,'Old',{text:'body',asset_ids:[aid]}]);
     await run(db,user,'select community_save_revision($1,$2,$3)',[item,'New',{text:'body',asset_ids:[]}]);
     await assert.rejects(run(db,user,'select community_prepare_asset_delete($1)',[aid]),/referenced/);
    }
    await assert.rejects(run(db,user,'delete from storage.objects where id=$1',[current.id]),/foreign key|cannot be deleted/);
    const orphanHistory=await Storage_Object(db,bucket,{archive:true}),orphan=await Storage_Object(db,bucket,{name:orphanHistory.name});
    await run(db,user,'select '+prefix+'_prepare_orphan_delete($1)',[orphan.id]);
    assert.equal((await run(db,user,'select private_object_finish_deletes() n')).rows[0].n,0,'failed Storage removal retains intent');
    await assert.rejects(run(db,user,'select '+prefix+'_register_asset($1,$2)',[orphan.name,'image.png']),/reserved/);
    // Historical deletion may fire old cleanup triggers: it must NOT clear intent.
    await db.query('delete from storage.objects where id=$1',[orphanHistory.id]);
    assert.equal((await db.query('select count(*)::int n from '+prefix+'_asset_delete_intents where object_path=$1',[orphan.name])).rows[0].n,1);
    const residual=await Storage_Object(db,bucket,{name:orphan.name,archive:true});
    await run(db,user,'delete from storage.objects where id=$1',[orphan.id]); // Isolated SQL model of HTTP current-row deletion.
    assert.equal((await run(db,user,'select private_object_finish_deletes() n')).rows[0].n,1,'unrelated archive does not block finish');
    assert.equal((await db.query('select id from storage.objects where id=$1',[residual.id])).rows.length,1);
    await Storage_Object(db,bucket,{name:orphan.name});
    await assert.rejects(run(db,user,'select '+prefix+'_register_asset($1,$2)',[orphan.name,'image.png']),/reserved/);
    const unused=await Storage_Object(db,bucket),ua=(await run(db,user,'select '+prefix+'_register_asset($1,$2) id',[unused.name,'image.png'])).rows[0].id;
    await run(db,user,'select '+prefix+'_prepare_asset_delete($1)',[ua]);
    await run(db,user,'delete from storage.objects where id=$1',[unused.id]);
    assert.equal((await run(db,user,'select private_object_finish_deletes() n')).rows[0].n,1);
   }
   await assert.rejects(db.exec(upgrade),/boundary|Incomplete/);await db.exec('rollback');
   assert.equal((await db.query("select count(*)::int n from storage.buckets where id in ('dm-media','community-assets') and versioning_status='DISABLED'")).rows[0].n,2);
  }finally{await db.close();}
 });
 test(engine+' fail-closed Storage contract and transaction rollback',{skip:!enabled},async()=>{
  const db=await create({through:'202610110004_idempotent_messages.sql',compatible:true,storage:'versioned'});
  try{
   const mutations=[
    'drop index storage.idx_objects_current_version',
    'drop index storage.idx_objects_current_version;create unique index misleading on storage.objects(bucket_id,name) where archived_at is null and not is_delete_marker',
    'drop index storage.idx_objects_current_version;create unique index misleading on storage.objects(bucket_id,name,version)',
    "update storage.buckets set versioning_status='ENABLED' where id='dm-media'",
    'alter table storage.objects alter column is_delete_marker drop not null',
    'alter table storage.objects disable row level security',
    'drop policy dm_media_update_guard on storage.objects',
    'alter table public.dm_client_requests disable row level security',
    'grant execute on function public.community_register_legacy_asset(uuid,text,text,text,bigint) to anon',
    'drop function public.dm_send_message_once(uuid,text,uuid[],uuid,uuid)',
    'delete from public.community_publication_config',
    "delete from public.community_management_audit where action='period_policy_migration'"
   ];
   for(const mutation of mutations){
    await db.exec('begin;'+mutation);
    await assert.rejects(db.exec(upgrade.replace('begin;','')),/Storage contract|Incomplete|boundary/);await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('public.private_object_tombstones') t")).rows[0].t,null);
   }
   await assert.rejects(db.exec(upgrade.replace(/commit;\s*$/,'select 1/0;commit;')),/division by zero/);await db.exec('rollback');
   assert.equal((await db.query("select to_regprocedure('public.private_object_is_current(storage.objects)') f")).rows[0].f,null);
   assert.equal((await db.query("select confdeltype from pg_constraint where conname='dm_assets_storage_object_id_fkey'")).rows[0].confdeltype,'c');
   await db.exec(upgrade);
  }finally{await db.close();}
 });
 test(engine+' already-applied 23 uses separate repair and cannot be replayed',{skip:!enabled},async()=>{
  const db=await create();try{
   await seedActors(db);
   await db.exec('drop index storage.dm_media_object_path;'+versionedStorageSQL);
   await db.exec(Storage_ForwardRepair());
   await assert.rejects(db.exec(Storage_ForwardRepair()),/boundary/);await db.exec('rollback');
   assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,4);
  }finally{await db.close();}
 });
}
test('Generated fresh bundle uses actual versioned indexes and checksummed immutable history',{skip:!modulePath},async()=>{
 const db=await createDatabase({through:'000',storage:'versioned'}),dir=await mkdtemp(path.join(tmpdir(),'storage-bundle-'));
 try{
  await Install_Build(dir);const manifest=JSON.parse(await readFile(path.join(dir,'storage-compatibility-manifest.json'),'utf8'));
  for(const artifact of manifest.artifacts)assert.equal(createHash('sha256').update(await readFile(path.join(dir,artifact.file),'utf8')).digest('hex'),artifact.lf_sha256);
  await db.exec((await readFile(path.join(dir,'fresh-install.sql'),'utf8')).replace('create extension if not exists pgcrypto;',''));
  assert.equal((await db.query('select community_capabilities() c')).rows[0].c.version,20261013);
  assert.equal((await db.query("select count(*)::int n from pg_index where indrelid='storage.objects'::regclass and indisunique and indnkeyatts=2 and indpred is null")).rows[0].n,0);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});
test('Previously applied historical boundaries 23, 24, 25 and 26 each accept only the separate forward repair',{skip:!modulePath},async()=>{
 for(const through of [file,'202610130002_release_contract.sql','202610130003_review_queue.sql','202610130004_moment_deletion.sql']){
  const db=await createDatabase({through});try{
   await db.exec('drop index storage.dm_media_object_path;'+versionedStorageSQL);
   await db.exec(Storage_ForwardRepair());
   assert.ok((await db.query("select to_regprocedure('private_object_is_current(storage.objects)') f")).rows[0].f);
   await assert.rejects(db.exec(upgrade),/boundary/);await db.exec('rollback');
  }finally{await db.close();}
 }
});
test('Native versioned Storage: both registration/delete orderings, both buckets, actual lock waits',{skip:!nativeConfigured},async()=>{
 const db=await createNativeDatabase({storage:'versioned',compatible:true});
 try{
  await seedActors(db);
  for(const [bucket,prefix] of [['dm-media','dm'],['community-assets','community']])for(const deletionFirst of [true,false]){
   const o=await Storage_Object(db,bucket),a=await db.connect(),b=await db.connect();
   for(const c of [a,b]){await c.query("begin;set local role authenticated;set local statement_timeout='5s'");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);}
   const register='select '+prefix+"_register_asset($1,'image.png')",prepare='select '+prefix+'_prepare_orphan_delete($1)';
   await a.query(deletionFirst?prepare:register,[deletionFirst?o.id:o.name]);
   const pid=(await b.query('select pg_backend_pid() p')).rows[0].p;
   let done=false;const pending=b.query(deletionFirst?register:prepare,[deletionFirst?o.name:o.id]).then(()=>({ok:true}),error=>({error})).finally(()=>{done=true;});
   let waiting=false;
   for(let attempt=0;attempt<50&&!done;attempt++){
    waiting=(await db.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting;
    if(waiting)break;await new Promise(r=>setTimeout(r,20));
   }
   assert.equal(waiting,true,'the second transaction really waits for the object lock');
   await a.query('commit');const result=await pending;
   assert.match(result.error?.message||'',deletionFirst?/reserved for deletion/:/registered/);
   await b.query('rollback');
  }
 }finally{await db.close();}
});
test('Registration rejects cross-bucket IDs, registry metadata drift, legacy markers and stale existing assets',{skip:!modulePath},async()=>{
 const db=await createDatabase({storage:'versioned',compatible:true});
 try{
  await seedActors(db);await db.query('update community_publication_config set legacy_author_id=$1',[user]);
  const good=await Storage_Object(db,'community-assets'),dm=await Storage_Object(db,'dm-media');
  for(const [oid,name,owner,mime] of [[good.id,good.name,other,'image/png'],[dm.id,dm.name,user,'image/png'],[good.id,good.name,user,'image/webp'],[good.id,user+'/'+randomUUID()+'.png',user,'image/png']]){
   await assert.rejects(db.query("insert into user_assets(owner_id,storage_object_id,object_path,original_name,mime_type,size_bytes) values($1,$2,$3,'x.png',$4,10)",[owner,oid,name,mime]),/unavailable|check constraint/);
  }
  const archived=await Storage_Object(db,'community-assets',{archive:true}),marker=await Storage_Object(db,'community-assets',{marker:true});
  for(const o of [archived,marker])await assert.rejects(db.query("select community_register_legacy_asset($1,$2,'x.png','image/png',10)",[user,o.name]),/Invalid legacy/);
  const legacy=(await db.query("select community_register_legacy_asset($1,$2,'x.png','image/png',10) id",[user,good.name])).rows[0].id;
  assert.equal((await db.query("select community_register_legacy_asset($1,$2,'x.png','image/png',10) id",[user,good.name])).rows[0].id,legacy);
  for(const who of [user,other,admin,null])await assert.rejects(run(db,who,"select community_register_legacy_asset($1,$2,'x.png','image/png',10)",[user,good.name]),/permission denied/);
  // A later out-of-band operator mutation must not make writes silently attach a stale object.
  await db.query("update storage.buckets set versioning_status='SUSPENDED' where id='community-assets'");
  await assert.rejects(run(db,user,"select community_register_asset($1,'x.png')",[good.name]),/DISABLED/);
 }finally{await db.close();}
 const partial=await createDatabase({storage:'versioned',compatible:true,through:'202610110004_idempotent_messages.sql'});
 try{
  await seedActors(partial);const o=await Storage_Object(partial,'community-assets',{archive:true});
  await partial.query("insert into user_assets(owner_id,storage_object_id,object_path,original_name,mime_type,size_bytes) values($1,$2,$3,'x.png','image/png',10)",[user,o.id,o.name]);
  await assert.rejects(partial.exec(upgrade),/existing registry\/object mismatch/);await partial.exec('rollback');
  assert.equal((await partial.query('select count(*)::int n from user_assets')).rows[0].n,1);
  assert.equal((await partial.query("select to_regclass('private_object_tombstones') t")).rows[0].t,null);
 }finally{await partial.close();}
});
test('Real Storage HTTP acceptance requires an isolated provisioned project',{skip:'No isolated Supabase Auth/Storage HTTP credentials configured; native PostgreSQL is not HTTP acceptance'},()=>{});

test('Existing boundary-22 users, private messages, revisions and registered object IDs survive 23–27 unchanged',{skip:!modulePath},async()=>{
 const db=await createDatabase({through:'202610110004_idempotent_messages.sql',compatible:true,storage:'versioned'});
 try{
  await seedActors(db);
  for(const [bucket,prefix] of [['dm-media','dm'],['community-assets','community']]){
   const o=await Storage_Object(db,bucket),aid=(await run(db,user,'select '+prefix+"_register_asset($1,'existing.png') id",[o.name])).rows[0].id;
   if(prefix==='dm'){
    const tid=(await run(db,user,'select dm_get_or_create_thread($1) id',[other])).rows[0].id;
    await run(db,user,'select dm_send_message($1,$2,$3)',[tid,'Existing private message',[aid]]);
   }else{
    const item=(await run(db,user,"select community_create_item('article','existing-draft') id")).rows[0].id;
    await run(db,user,'select community_save_revision($1,$2,$3)',[item,'Existing title',{text:'Existing body',asset_ids:[aid]}]);
   }
  }
  const tables=['auth.users','public.profiles','public.user_roles','public.dm_threads','public.dm_messages','public.dm_message_assets','public.dm_assets','public.user_assets','public.content_revisions','public.revision_assets','storage.objects'];
  const snapshot=async()=>{const rows={};for(const table of tables)rows[table]=(await db.query('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),\'[]\'::jsonb) data from '+table+' t')).rows[0].data;return rows;};
  const before=await snapshot();await db.exec(upgrade);
  for(const name of ['202610130002_release_contract.sql','202610130003_review_queue.sql','202610130004_moment_deletion.sql','202610180001_article_settings_and_profile_search.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  assert.deepEqual(await snapshot(),before);
 }finally{await db.close();}
});
