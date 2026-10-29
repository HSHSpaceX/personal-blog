import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDatabase,seedActors,asActor,actors,modulePath} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {Legacy_Plan,Legacy_Import} from '../scripts/legacy-community-import.mjs';
import {desiredSnapshot} from '../scripts/sync-community-public.mjs';
import {Install_Transform,Install_Build} from '../scripts/build-compatible-install.mjs';
import publicData from '../js/community-public.js';
const read=n=>readFile(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const {user,other,admin,admin2}=actors;
const run=(db,id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
async function service(db,sql,args=[]){await db.exec('begin;set local role service_role');try{const r=await db.query(sql,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
async function protection(db){
 await db.exec(await readFile(new URL('../supabase/preflight.sql',import.meta.url),'utf8'));
 await seedActors(db);
 const object=async(bucket,who=user)=>{const name=who+'/'+randomUUID()+'.png';return (await run(db,who,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3) returning id,name',[bucket,name,{mimetype:'image/png',size:10}])).rows[0];};
 for(const [bucket,prefix,table] of [['dm-media','dm','dm_assets'],['community-assets','community','user_assets']]){
  const o=await object(bucket),a=(await run(db,user,'select '+prefix+'_register_asset($1,$2) id',[o.name,'image.png'])).rows[0].id;
  await assert.rejects(run(db,user,'delete from storage.objects where id=$1',[o.id]),/foreign key|cannot be deleted/);
  assert.equal((await run(db,user,'update storage.objects set metadata=metadata where id=$1 returning id',[o.id])).rows.length,0);
  for(const who of [other,admin,admin2,null])assert.equal((await run(db,who,'select id from storage.objects where id=$1',[o.id])).rows.length,0);
  if(prefix==='dm'){
   const t=(await run(db,user,'select dm_get_or_create_thread($1) id',[other])).rows[0].id;await run(db,user,'select dm_send_message($1,$2,$3)',[t,'private',[a]]);
   assert.equal((await run(db,other,'select id from storage.objects where id=$1',[o.id])).rows.length,1);
   await assert.rejects(run(db,user,'select dm_prepare_asset_delete($1)',[a]),/cannot be deleted/);
   for(const who of [admin,admin2,null])assert.equal((await run(db,who,'select id from storage.objects where id=$1',[o.id])).rows.length,0);
  }else {const i=(await run(db,user,"select community_create_item('article',$1) id",['protected-'+randomUUID()])).rows[0].id;await run(db,user,'select community_save_revision($1,$2,$3)',[i,'Title',{text:'protected',category:'杂谈',asset_ids:[a]}]);await assert.rejects(run(db,user,'select community_prepare_asset_delete($1)',[a]),/referenced/);}
  const orphan=await object(bucket);await run(db,user,'select '+prefix+'_prepare_orphan_delete($1)',[orphan.id]);
  await assert.rejects(run(db,user,'select '+prefix+'_register_asset($1,$2)',[orphan.name,'image.png']),/reserved for deletion/);
  await run(db,user,'delete from storage.objects where id=$1',[orphan.id]);await run(db,user,'select private_object_finish_deletes()');
  await run(db,user,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,orphan.name,{mimetype:'image/png',size:10}]);
  await assert.rejects(run(db,user,'select '+prefix+'_register_asset($1,$2)',[orphan.name,'image.png']),/reserved for deletion/);
  const unused=await object(bucket),ua=(await run(db,user,'select '+prefix+'_register_asset($1,$2) id',[unused.name,'image.png'])).rows[0].id;
  await run(db,user,'select '+prefix+'_prepare_asset_delete($1)',[ua]);assert.equal((await db.query('select id from '+table+' where id=$1',[ua])).rows.length,0);await run(db,user,'delete from storage.objects where id=$1',[unused.id]);await run(db,user,'select private_object_finish_deletes()');
 }
 assert.equal((await service(db,'select community_release_preflight() r')).rows[0].r.version,20261013);
 await db.exec(await readFile(new URL('../supabase/postflight.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'community_release_preflight()','execute') ok",[role])).rows[0].ok,false);
}
for(const state of ['original','trimmed','fresh-compatible'])test('Storage upgrade '+state+': full chain, isolation, immutable references, tombstones and cleanup',{skip:!modulePath},async()=>{
 const db=await createDatabase(state==='fresh-compatible'?{compatible:true}:{through:'202610110004_idempotent_messages.sql'});try{
  if(state==='trimmed')await db.exec('drop index storage.dm_media_object_path;drop trigger dm_media_immutable on storage.objects;drop trigger dm_media_orphan_guard on storage.objects;drop trigger dm_media_delete_cleanup on storage.objects;');
  if(state!=='fresh-compatible')for(const n of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.startsWith('20261013')).sort())await db.exec(Install_Transform(n,await read(n)));
  await protection(db);
  await assert.rejects(db.exec(Install_Transform('202610130001_storage_compatibility.sql',await read('202610130001_storage_compatibility.sql'))),/Incomplete installation|boundary/);await db.exec('rollback');
 }finally{await db.close();}
});
test('Partial installation stops with no new tables; originals have locked checksums; restricted role cannot add managed DDL',{skip:!modulePath},async()=>{
 const db=await createDatabase({through:'202610070002_direct_messages.sql',compatible:true});try{await assert.rejects(db.exec(await read('202610130001_storage_compatibility.sql')),/Incomplete installation/);await db.exec('rollback');assert.equal((await db.query("select to_regclass('public.private_object_tombstones') t")).rows[0].t,null);
 await db.exec('create role migration_limited;grant usage on schema storage to migration_limited;grant select,insert,update,delete,references on storage.objects to migration_limited;');
 for(const ddl of ['create index forbidden on storage.objects(name)','create trigger forbidden before update on storage.objects for each row execute function public.dm_guard_object()']){await db.exec('begin;set local role migration_limited');await assert.rejects(db.exec(ddl),/owner|permission denied/);await db.exec('rollback');}
 assert.throws(()=>Install_Transform('202610070002_direct_messages.sql',(awaitSQL)+' '),/checksum/);
 }finally{await db.close();}
});
const awaitSQL=await read('202610070002_direct_messages.sql');
test('Generated fresh install bundle is one working transaction, and partial release advertises no write capability',{skip:!modulePath},async()=>{
 const db=await createDatabase({through:'000'}),dir=await mkdtemp(path.join(tmpdir(),'compatible-bundle-'));try{
  const manifest=await Install_Build(dir);assert.equal(manifest.filter(m=>m.removed_managed_triggers.length).length,3);
  await db.exec((await readFile(path.join(dir,'fresh-install.sql'),'utf8')).replace('create extension if not exists pgcrypto;',''));
  assert.equal((await db.query('select community_capabilities() c')).rows[0].c.version,20261013);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
 const partial=await createDatabase({through:'202610130002_release_contract.sql',compatible:true});try{assert.equal((await partial.query('select community_capabilities() c')).rows[0].c.version,0);await assert.rejects(service(partial,'select community_release_preflight()'),/entire release/);}finally{await partial.close();}
});
test('Review comments: three outcomes, reasons, stale decisions, trash lock and restoration',{skip:!modulePath},async()=>{
 const db=await createDatabase({compatible:true});try{await seedActors(db);
  for(const decision of ['approved','returned','trashed']){
   const id=(await run(db,user,"insert into comments(user_id,post_slug,content) values($1,'post-austria-history','review body') returning id",[user])).rows[0].id;
   await assert.rejects(run(db,other,"select community_review_entry('comment',$1,$2,$3,'review body')",[id,decision,decision==='approved'?null:'reason']),/Admin/);
   if(decision!=='approved')await assert.rejects(run(db,admin,"select community_review_entry('comment',$1,$2,null,'review body')",[id,decision]),/reason/);
   await run(db,admin,"select community_review_entry('comment',$1,$2,$3,'review body')",[id,decision,decision==='approved'?null:'reason']);
   await assert.rejects(run(db,admin2,"select community_review_entry('comment',$1,'approved',null,'review body')",[id]),/already reviewed/);
   const queue=(await run(db,admin,"select * from community_review_queue('comment',$1,'',false,20,0)",[decision])).rows;
   assert.ok(queue.some(r=>Object.values(r)[0].id===id));
   if(decision==='trashed'){await assert.rejects(run(db,user,"select community_edit_comment($1,'retry')",[id]),/trash/);await run(db,admin,"select community_restore_comment('comment',$1)",[id]);await run(db,user,"select community_edit_comment($1,'retry')",[id]);}
  }
 }finally{await db.close();}
});
test('Forward Storage repair runs as business-object owner without managed-table ownership',{skip:!nativeConfigured},async()=>{
 // Native catalogs have PostgreSQL's real metadata ACLs; PGlite restricts pg_am.
 const db=await createNativeDatabase({through:'202610110004_idempotent_messages.sql',compatible:true,storage:'versioned'});try{
  await db.exec(`create role migration_business bypassrls;
   grant usage,create on schema public to migration_business;
   grant usage on schema auth,storage to migration_business;
   grant select,insert,update,delete,references on storage.objects to migration_business;
   grant select on auth.users,storage.buckets to migration_business;
   do $$declare obj record;begin
    for obj in select c.oid::regclass as name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' loop
     execute format('alter table %s owner to migration_business',obj.name);
    end loop;
    for obj in select p.oid::regprocedure as name from pg_proc p where p.pronamespace='public'::regnamespace loop execute format('alter function %s owner to migration_business',obj.name);end loop;
   end$$;
   set role migration_business;`);
  await assert.rejects(db.exec('create index managed_forbidden on storage.objects(name)'),/owner|permission/);
  await db.exec(Install_Transform('202610130001_storage_compatibility.sql',await read('202610130001_storage_compatibility.sql')));
  await db.exec('reset role');
  assert.equal((await db.query("select pg_get_userbyid(relowner)='migration_business' owned from pg_class where oid='storage.objects'::regclass")).rows[0].owned,false);
  assert.equal((await db.query("select confdeltype from pg_constraint where conrelid='public.dm_assets'::regclass and conname='dm_assets_storage_object_id_fkey'")).rows[0].confdeltype,'r');
 }finally{await db.close();}
});
test('Nine categories, atomic first draft, review queue, first publication date and soft deletion',{skip:!modulePath},async()=>{
 const db=await createDatabase({compatible:true});try{await seedActors(db);const categories=(await db.query('select community_article_categories() c')).rows[0].c;const context={window:{}};const vm=await import('node:vm');vm.runInNewContext(await readFile(new URL('../js/categories.js',import.meta.url),'utf8'),context);assert.deepEqual(categories,Array.from(context.window.BLOG_CATEGORY_GROUPS.flatMap(g=>g.cats.map(c=>c.name))));
 const args=['article','atomic-draft','Title',{text:'body',category:'软件设计'}];const id=(await run(db,user,'select community_create_draft($1,$2,$3,$4) id',args)).rows[0].id;assert.equal((await run(db,user,'select community_create_draft($1,$2,$3,$4) id',args)).rows[0].id,id);
 await assert.rejects(run(db,user,'select community_create_draft($1,$2,$3,$4)',['article','invalid-category','Bad',{text:'body',category:'任意投稿'}]),/nine/);
 await run(db,user,'select community_submit_revision($1)',[id]);assert.equal((await run(db,admin,"select * from community_review_queue('article','pending','',false,20,0)")).rows.length,1);await assert.rejects(run(db,other,'select * from community_review_queue()'),/Admin/);
 await assert.rejects(run(db,admin,"select community_review_entry('content',$1,'returned')",[id]),/reason/);await run(db,admin,"select community_review_entry('content',$1,'approved')",[id]);
 const before=(await service(db,'select community_publication_export() r')).rows[0].r[0];const itemId=before.id;
 await db.query("update content_first_publications set approved_at='2020-01-01' where item_id=$1",[itemId]);const edit=(await run(db,user,'select community_save_revision($1,$2,$3) id',[itemId,'Edited',args[3]])).rows[0].id;await run(db,user,'select community_submit_revision($1)',[edit]);assert.equal((await service(db,'select community_publication_export() r')).rows[0].r[0].title,'Title');await run(db,admin,"select community_review_entry('content',$1,'approved')",[edit]);assert.match((await service(db,'select community_publication_export() r')).rows[0].r[0].published_at,/2020-01-01/);
 const mid=(await run(db,user,"select community_create_draft('moment','my-moment','动态','{\"text\":\"hello\",\"asset_ids\":[]}'::jsonb) id")).rows[0].id;const mi=(await db.query('select item_id from content_revisions where id=$1',[mid])).rows[0].item_id;await assert.rejects(run(db,other,'select community_delete_moment($1)',[mi]),/own moment/);await run(db,user,'select community_delete_moment($1)',[mi]);await run(db,user,'select community_delete_moment($1)',[mi]);await assert.rejects(run(db,user,'select community_submit_revision($1)',[mid]),/Deleted content/);assert.equal((await service(db,'select community_deleted_export() r')).rows[0].r[0].id,mi);
 }finally{await db.close();}
});
test('Actual repository legacy import into local database twice, then edit/review/export without duplicates',{skip:!modulePath||!process.env.COMMUNITY_DOM_MODULE},async()=>{
 const db=await createDatabase({compatible:true}),{JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('');try{await seedActors(db);await db.query('update community_publication_config set legacy_author_id=$1 where singleton',[user]);const plan=await Legacy_Plan(),files=new Map();const adapter={
 preflight:async(entries,owner)=>{const ready=(await service(db,'select community_release_preflight() r')).rows[0].r;assert.equal(ready.legacy_owner_id,owner);},
 upload:async(name,bytes,mime)=>{if(files.has(name)){assert.deepEqual(files.get(name),bytes);return;}files.set(name,bytes);await db.query("insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2)",[name,{mimetype:mime,size:bytes.length}]);},
 register:async(owner,a)=>(await service(db,'select community_register_legacy_asset($1,$2,$3,$4,$5) id',[owner,a.object_path,a.original_name,a.mime_type,a.size_bytes])).rows[0].id,
 import:async(owner,e,body)=>(await service(db,'select community_import_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[owner,e.type,e.slug,e.target_id,e.source_sha256,e.row.title||'动态',body,e.published_at,!!e.row.featured])).rows[0].id};
 const first=await Legacy_Import(plan,{owner:user,DOMParser:dom.window.DOMParser,adapter}),count=files.size;assert.deepEqual(await Legacy_Import(plan,{owner:user,DOMParser:dom.window.DOMParser,adapter}),first);assert.equal(files.size,count);assert.equal((await db.query('select count(*)::int n from content_items')).rows[0].n,plan.entries.length);
 const rows=(await service(db,'select community_publication_export() r')).rows[0].r;const publication={download:async p=>files.get(p),publicURL:p=>'https://fixture.supabase.invalid/storage/v1/object/public/published-media/'+p};const {snapshot}=await desiredSnapshot(rows,publication);const articles=plan.entries.filter(e=>e.type==='article');assert.equal(publicData.mergePosts(articles.map(e=>e.row),snapshot).length,articles.length);
 const row=rows.find(r=>r.content_type==='article');if(row){const rev=(await run(db,user,'select community_save_revision($1,$2,$3) id',[row.id,'历史内容修改预演',row.body])).rows[0].id;await run(db,user,'select community_submit_revision($1)',[rev]);assert.equal((await service(db,'select community_publication_export() r')).rows[0].r.find(r=>r.id===row.id).revision_id,row.revision_id);await run(db,admin,"select community_review_revision($1,'approved')",[rev]);const out=(await service(db,'select community_publication_export() r')).rows[0].r.find(r=>r.id===row.id);assert.equal(out.slug,row.slug);assert.equal(out.legacy.published_at,row.legacy.published_at);assert.equal(out.revision_id,rev);}
 console.log('Local legacy rehearsal:',JSON.stringify({entries:plan.entries.map(e=>({type:e.type,id:e.target_id,date:e.published_at,mismatches:e.files.filter(f=>f.extension_mismatch).map(f=>f.path)})),uniqueMedia:count}));
 }finally{dom.window.close();await db.close();}
});
test('Native compatible DB: object lock serializes orphan preparation against registration',{skip:!nativeConfigured},async()=>{
 const db=await createNativeDatabase({compatible:true});try{await seedActors(db);const name=user+'/'+randomUUID()+'.png',oid=(await run(db,user,"insert into storage.objects(bucket_id,name,metadata) values('dm-media',$1,'{\"mimetype\":\"image/png\",\"size\":10}') returning id",[name])).rows[0].id;
 const a=await db.connect(),b=await db.connect();await a.query('begin;set local role authenticated');await a.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await a.query('select dm_prepare_orphan_delete($1)',[oid]);let finished=false;await b.query('begin;set local role authenticated');await b.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);const pending=b.query("select dm_register_asset($1,'image.png')",[name]).then(()=>({ok:true}),e=>({error:e.message})).finally(()=>finished=true);await new Promise(r=>setTimeout(r,80));assert.equal(finished,false);await a.query('commit');assert.match((await pending).error,/reserved for deletion/);await b.query('rollback');await run(db,user,'delete from storage.objects where id=$1',[oid]);
 }finally{await db.close();}
});
