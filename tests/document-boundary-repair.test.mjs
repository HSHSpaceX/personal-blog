import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase,modulePath,seedActors,actors,asActor} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {Storage_Diagnose22,Storage_MissingDocumentGuard,Storage_RepairMissingDocument} from '../scripts/storage-compatibility.mjs';
import {Install_Transform} from '../scripts/build-compatible-install.mjs';
const read=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const old=(await read('202610070004_category_raw_length.sql')).match(/create or replace function[\s\S]*?\$\$;/)[0];
const missing=`drop trigger community_document_cover on content_revisions;
drop function community_check_document_cover();drop function community_validate_document(jsonb,uuid[],integer,text);drop function community_validate_inline(jsonb);`+old;
for(const [engine,create,enabled] of [['PGlite',createDatabase,!!modulePath],['PostgreSQL',createNativeDatabase,nativeConfigured]])test(engine+': reproduce eight missing-18 differences, repair atomically, retain rows, then upgrade 23–27',{skip:!enabled},async()=>{
 const db=await create({through:'202610110004_idempotent_messages.sql',compatible:true,storage:'versioned'});
 try{
  await seedActors(db);
  const run=(sql,args)=>asActor(db,'authenticated',actors.user,sql,args);
  const id=(await run("select community_create_item('article','retain-history') id")).rows[0].id;
  await run('select community_save_revision($1,$2,$3)',[id,'Keep',{text:'original'}]);
  const before=JSON.stringify((await db.query('select * from content_revisions order by id')).rows);
  await db.exec(missing);
  await assert.rejects(db.exec(Storage_Diagnose22()),/boundary/);await db.exec('rollback');
  await db.exec('begin read only;'+Storage_MissingDocumentGuard()+'rollback;');
  await assert.rejects(db.exec(Storage_RepairMissingDocument().replace(/commit;\s*$/,'select 1/0;commit;')),/division by zero/);await db.exec('rollback');
  assert.equal((await db.query("select to_regprocedure('community_validate_inline(jsonb)') f")).rows[0].f,null);
  await db.exec("grant execute on function community_validate_body(text,jsonb) to authenticated");
  await assert.rejects(db.exec(Storage_RepairMissingDocument()),/boundary/);await db.exec('rollback');
  await db.exec("revoke execute on function community_validate_body(text,jsonb) from authenticated");
  await db.exec(Storage_RepairMissingDocument());await db.exec(Storage_Diagnose22());
  assert.equal(JSON.stringify((await db.query('select * from content_revisions order by id')).rows),before);
  await assert.rejects(run('select community_validate_inline($1)',[JSON.stringify([{text:'x'}])]),/permission denied/);
  await assert.rejects(run('select community_save_revision($1,$2,$3)',[id,'Bad',{text:'x',document:{version:1,blocks:[{type:'script'}]}}]),/Unknown document block/);
  await assert.rejects(db.exec(Storage_RepairMissingDocument()),/boundary/);await db.exec('rollback');
  for(const name of ['202610130001_storage_compatibility.sql','202610130002_release_contract.sql','202610130003_review_queue.sql','202610130004_moment_deletion.sql','202610180001_article_settings_and_profile_search.sql'])await db.exec(Install_Transform(name,await read(name)));
  const ready=(await db.query('select community_capabilities() c')).rows[0].c;assert.ok(ready);
  assert.equal(JSON.stringify((await db.query('select * from content_revisions order by id')).rows),before);
 }finally{await db.close();}
});
