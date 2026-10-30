import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createDatabase,modulePath,seedActors,asActor,actors} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {versionedStorageSQL} from './helpers/storage-fixture.mjs';
import {Storage_Diagnose22,Storage_RepairCompatibleV1,Storage_ForwardRepair} from '../scripts/storage-compatibility.mjs';
const {user,other}=actors;
const run=(db,id,sql,args=[])=>asActor(db,'authenticated',id,sql,args);
const v1=await readFile(new URL('./fixtures/storage/runtime-v1.sql',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(v1.replace(/\r\n/g,'\n')).digest('hex'),'154f1edeb0dc34c7d8b88dc7df496721ec997fc3f5f4d715881a1ee5c1c16958');
async function Storage_CreateObject(db,bucket,owner=user,ownerId=user){
 const name=user+'/'+randomUUID()+'.png';
 return (await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values($1,$2,$3,$4,'{\"mimetype\":\"image/png\",\"size\":10}') returning id,name",[bucket,name,owner,ownerId])).rows[0];
}
for(const [engine,create,enabled] of [['PGlite',createDatabase,!!modulePath],['PostgreSQL',createNativeDatabase,nativeConfigured]]){
 test(engine+': native owner contradictions reject registration and deletion; ownerless service uploads retain path authorization',{skip:!enabled},async()=>{
  const db=await create({compatible:true,storage:'versioned'});
  try{
   await seedActors(db);await db.query('update community_publication_config set legacy_author_id=$1',[user]);
   for(const [bucket,prefix,table] of [['dm-media','dm','dm_assets'],['community-assets','community','user_assets']]){
    for(const [owner,ownerId] of [[user,other],[other,user],[null,other],[user,'']]){
     const o=await Storage_CreateObject(db,bucket,owner,ownerId);
     await assert.rejects(run(db,user,'select '+prefix+"_register_asset($1,'x.png')",[o.name]),/Upload|upload|unavailable/);
     await assert.rejects(run(db,other,'select '+prefix+"_register_asset($1,'x.png')",[o.name]),/unavailable/);
     await assert.rejects(run(db,user,'select '+prefix+'_prepare_orphan_delete($1)',[o.id]),/unavailable/);
     assert.ok(!(await run(db,user,'select * from '+prefix+'_orphan_assets()')).rows.some(r=>r.object_id===o.id));
     await assert.rejects(db.query('insert into '+table+"(owner_id,storage_object_id,object_path,original_name,mime_type,size_bytes) values($1,$2,$3,'x.png','image/png',10)",[user,o.id,o.name]),/unavailable/);
     if(prefix==='community')await assert.rejects(db.query("select community_register_legacy_asset($1,$2,'x.png','image/png',10)",[user,o.name]),/Invalid legacy/);
    }
    const o=await Storage_CreateObject(db,bucket,null,null);
    await assert.rejects(run(db,other,'select '+prefix+"_register_asset($1,'x.png')",[o.name]),/unavailable/);
    const aid=(await run(db,user,'select '+prefix+"_register_asset($1,'x.png') id",[o.name])).rows[0].id;
    await run(db,user,'select '+prefix+'_prepare_asset_delete($1)',[aid]);
    await db.query('update storage.objects set owner_id=$1 where id=$2',[other,o.id]);
    assert.equal((await run(db,user,'select private_object_finish_deletes() n')).rows[0].n,0,'owner drift must not be mistaken for an absent current object');
    assert.equal((await db.query('select count(*)::int n from '+prefix+'_asset_delete_intents where object_path=$1',[o.name])).rows[0].n,1);
   }
   const legacy=await Storage_CreateObject(db,'community-assets',null,null);
   assert.ok((await db.query("select community_register_legacy_asset($1,$2,'x.png','image/png',10) id",[user,legacy.name])).rows[0].id);
   assert.equal((await db.query("select has_function_privilege('authenticated','private_object_matches_owner(storage.objects,uuid)','execute') ok")).rows[0].ok,false);
  }finally{await db.close();}
 });
 test(engine+': candidate-22 read-only diagnostics catch pending deletion and registry drift before any DDL',{skip:!enabled},async()=>{
  const db=await create({compatible:true,storage:'versioned',through:'202610110004_idempotent_messages.sql'});
  try{
   await seedActors(db);const o=await Storage_CreateObject(db,'dm-media');
   const aid=(await run(db,user,"select dm_register_asset($1,'x.png') id",[o.name])).rows[0].id;
   await db.exec(Storage_Diagnose22());
   for(const change of ["owner_id='"+other+"'","metadata='{}'::jsonb","is_delete_marker=true","archived_at=now()"]){
    await db.exec('update storage.objects set '+change+" where id='"+o.id+"'");
    await assert.rejects(db.exec(Storage_Diagnose22()),/existing registry\/object mismatch/);await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('private_object_tombstones') t")).rows[0].t,null);
    assert.equal((await db.query('select storage_object_id from dm_assets where id=$1',[aid])).rows[0].storage_object_id,o.id);
    await db.query("update storage.objects set owner_id=$1,metadata='{\"mimetype\":\"image/png\",\"size\":10}',is_delete_marker=false,archived_at=null where id=$2",[user,o.id]);
   }
   await run(db,user,'select dm_prepare_asset_delete($1)',[aid]);
   await assert.rejects(db.exec(Storage_Diagnose22()),/Pending historical deletion/);await db.exec('rollback');
   assert.equal((await db.query('select count(*)::int n from dm_asset_delete_intents')).rows[0].n,1);
   assert.equal((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname like 'private_object_%'")).rows[0].n,0);
  }finally{await db.close();}
 });
 test(engine+': compatibility-v1 upgrades in one forward transaction, preserves sent assets, rejects replay and rolls back late errors',{skip:!enabled},async()=>{
  const db=await create({through:'202610130001_storage_compatibility.sql'});
  try{
   await db.exec(v1);await db.exec('drop index storage.dm_media_object_path;'+versionedStorageSQL);await seedActors(db);
   const o=await Storage_CreateObject(db,'dm-media'),aid=(await run(db,user,"select dm_register_asset($1,'x.png') id",[o.name])).rows[0].id;
   const thread=(await run(db,user,'select dm_get_or_create_thread($1) id',[other])).rows[0].id;
   await run(db,user,'select dm_send_message($1,$2,$3)',[thread,'preserve v1',[aid]]);
   await assert.rejects(db.exec(Storage_ForwardRepair()),/boundary/);await db.exec('rollback');
   await assert.rejects(db.exec(Storage_RepairCompatibleV1().replace(/commit;\s*$/,'select 1/0;commit;')),/division by zero/);await db.exec('rollback');
   assert.equal((await db.query("select to_regprocedure('private_object_matches_owner(storage.objects,uuid)') f")).rows[0].f,null);
   await db.exec(Storage_RepairCompatibleV1());
   await assert.rejects(run(db,user,'select dm_prepare_asset_delete($1)',[aid]),/cannot be deleted/);
   assert.equal((await db.query('select storage_object_id from dm_assets where id=$1',[aid])).rows[0].storage_object_id,o.id);
   const bad=await Storage_CreateObject(db,'dm-media',other,other);
   await assert.rejects(run(db,user,"select dm_register_asset($1,'x.png')",[bad.name]),/Upload|upload|unavailable/);
   await assert.rejects(db.exec(Storage_RepairCompatibleV1()),/boundary/);await db.exec('rollback');
  }finally{await db.close();}
 });
}
test('Compatibility-v1 completed boundaries 24–27 each use the same reviewed forward patch',{skip:!modulePath},async()=>{
 for(const through of ['202610130002_release_contract.sql','202610130003_review_queue.sql','202610130004_moment_deletion.sql','202610180001_article_settings_and_profile_search.sql']){
  const db=await createDatabase({through});try{
   await db.exec(v1);await db.exec(Storage_RepairCompatibleV1());
   assert.ok((await db.query("select to_regprocedure('private_object_matches_owner(storage.objects,uuid)') f")).rows[0].f);
  }finally{await db.close();}
 }
});
