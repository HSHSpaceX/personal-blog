import {Fixture_CopySite} from './helpers/site-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createDatabase,seedActors,asActor,actors,modulePath} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {Legacy_Plan,Legacy_Import} from '../scripts/legacy-community-import.mjs';
import legacy from '../js/legacy-content.js';
import publicData from '../js/community-public.js';
import {reconcile} from '../scripts/sync-community-public.mjs';
import {fixture} from './fixtures/community-publish/source.mjs';
const {user,other,admin}=actors;
async function checks(db){
 await seedActors(db);const run=(id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
 async function service(sql,args=[]){await db.exec('begin;set local role service_role');try{const r=await db.query(sql,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const object=user+'/'+randomUUID()+'.png';const obj=(await run(user,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2) returning id",[object,{mimetype:'image/png',size:90*1024*1024}])).rows[0].id;
 const asset=(await run(user,'select community_register_asset($1,$2) id',[object,'ninety.png'])).rows[0].id;
 for(const id of [null,other,admin])assert.equal((await run(id,'select id from storage.objects where id=$1',[obj])).rows.length,0);
 assert.equal((await run(admin,'select id from user_assets where id=$1',[asset])).rows.length,0);
 const big=user+'/'+randomUUID()+'.png';await run(user,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2)",[big,{mimetype:'image/png',size:90*1024*1024+1}]);await assert.rejects(run(user,'select community_register_asset($1,$2)',[big,'too-large.png']),/Unsupported asset/);
 const item=(await run(user,"select community_create_item('article',$1) id",['final-'+randomUUID()])).rows[0].id;
 const revision=(await run(user,'select community_save_revision($1,$2,$3) id',[item,'Review',{text:'safe',asset_ids:[asset]}])).rows[0].id;
 assert.equal((await run(admin,'select id from user_assets where id=$1',[asset])).rows.length,0);await run(user,'select community_submit_revision($1)',[revision]);
 assert.equal((await run(admin,'select id from user_assets where id=$1',[asset])).rows.length,1);assert.equal((await run(admin,'select id from storage.objects where id=$1',[obj])).rows.length,1);
 for(const who of [null,other])assert.equal((await run(who,'select id from storage.objects where id=$1',[obj])).rows.length,0);
 const thread=(await run(user,'select dm_get_or_create_thread($1) id',[other])).rows[0].id,nonce=randomUUID();
 const send=(who=user,body='private retry')=>run(who,'select dm_send_message_once($1,$2,$3,$4,$5) id',[thread,body,[],nonce,who]);
 const first=(await send()).rows[0].id;assert.equal((await send()).rows[0].id,first);assert.equal(Number((await db.query('select count(*) n from dm_messages where thread_id=$1',[thread])).rows[0].n),1);
 assert.equal(Number((await db.query("select count(*) n from notifications where type='direct_message' and user_id=$1",[other])).rows[0].n),1);
 await assert.rejects(send(user,'changed payload'),/retry payload changed/);await assert.rejects(send(admin),/Thread unavailable/);
 const settings={siteName:'拾光手记',introTitle:'首页',introText:'文字',aboutTitle:'HSH',aboutText:'杂谈',contactEmail:'HSH20130730@outlook.com',aboutDocument:{version:1,blocks:[{type:'paragraph',runs:[{text:'<script>inert</script>'}]}]}};
 for(const id of [null,user,other])await assert.rejects(run(id,'select community_save_site_settings($1)',[settings]),/permission denied|Admin required/);
 const saved=(await run(admin,'select community_save_site_settings($1) id',[settings])).rows[0].id;
 assert.equal((await run(user,'select * from community_site_settings')).rows.length,0);assert.equal((await run(admin,'select * from community_site_settings')).rows.length,1);
 await assert.rejects(run(admin,'select community_save_site_settings($1)',[{...settings,aboutDocument:{version:1,blocks:[{type:'paragraph',runs:[{text:'bad',href:'javascript:alert(1)'}]}]}}]),/Invalid|Unsafe|document|link/);
 for(const id of [null,user,admin])await assert.rejects(run(id,'select community_site_settings_export()'),/permission denied/);
 assert.equal((await service('select community_site_settings_export() s')).rows[0].s.id,saved);
 await db.query('update community_publication_config set legacy_author_id=$1',[user]);
 const legacyPath=user+'/'+randomUUID()+'.png';await run(user,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2)",[legacyPath,{mimetype:'image/png',size:50}]);
 const legacyAssetArgs=[user,legacyPath,'legacy.png','image/png',50],register='select community_register_legacy_asset($1,$2,$3,$4,$5) id';
 for(const id of [null,user,admin])await assert.rejects(run(id,register,legacyAssetArgs),/permission denied/);
 const legacyAsset=(await service(register,legacyAssetArgs)).rows[0].id;assert.equal((await service(register,legacyAssetArgs)).rows[0].id,legacyAsset);
 await assert.rejects(service(register,[other,legacyPath,'legacy.png','image/png',50]),/Configured legacy owner/);
 await assert.rejects(service(register,[user,legacyPath,'legacy.png','image/jpeg',50]),/Invalid legacy asset/);
 await assert.rejects(service(register,[user,legacyPath,'legacy.png','image/png',51]),/Invalid legacy asset/);
 const args=[user,'article','existing-legacy','existing-legacy','a'.repeat(64),'Original',{text:'safe legacy',category:'杂谈',tags:['保留']},'2026-09-20T00:00:00Z',true];
 for(const id of [null,user,admin])await assert.rejects(run(id,'select community_import_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9)',args),/permission denied/);
 const imported=(await service('select community_import_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9) id',args)).rows[0].id;
 assert.equal((await service('select community_import_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9) id',args)).rows[0].id,imported);
 await assert.rejects(service('select community_import_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9)',args.map((v,i)=>i===4?'b'.repeat(64):v)),/source changed/);
 const card=(await db.query("select community_public_target('content',$1) c",[imported])).rows[0].c;assert.equal(card.target_type,'post');assert.equal(card.target_id,'existing-legacy');assert.equal(card.target_path,'posts/existing-legacy.html');assert.match(card.published_at,/2026-09-20/);
 await db.query('delete from auth.users where id=$1',[admin]);assert.equal((await service('select community_site_settings_export() s')).rows[0].s.id,saved,'public site copy survives administrator deletion');
 for(const name of ['community_import_legacy(uuid,text,text,text,text,text,jsonb,timestamptz,boolean)','community_register_legacy_asset(uuid,text,text,text,bigint)','community_cycle_lock(uuid,text)','community_record_first_publication(uuid,uuid)','community_publication_export_base()','community_public_target_base(text,text)'])for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.'||$2,'EXECUTE') ok",[role,name])).rows[0].ok,false);
}
test('Final private media, 90 MiB, reviewer scope, idempotent DM, site admin ACLs and audited legacy identity',{skip:!modulePath},async()=>{const db=await createDatabase();try{await checks(db);}finally{await db.close();}});
test('Final native PostgreSQL private media, retry and management authority',{skip:!nativeConfigured},async()=>{const db=await createNativeDatabase();try{await checks(db);}finally{await db.close();}});
test('Legacy conversion/import dry-run preserves real main documents, rejects unsafe markup, and never includes private albums',{skip:!process.env.COMMUNITY_DOM_MODULE},async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('');try{
  for(const html of ['<script>x</script>','<img onerror="x" src="assets/a.png">','<iframe src="x"></iframe>','<a href="javascript:x">x</a>'])assert.throws(()=>legacy.convert(html,{DOMParser:dom.window.DOMParser}));
  const plan=await Legacy_Plan(),events=[],converted=[];await Legacy_Import(plan,{owner:user,DOMParser:dom.window.DOMParser,adapter:{preflight:async e=>events.push(['preflight',e.length]),upload:async(...args)=>events.push(['upload',args[0]]),register:async(owner,a)=>a.id,import:async(owner,e,body)=>{converted.push({e,body});return randomUUID();}}});
  assert.equal(events[0][0],'preflight');assert.equal(converted.length,plan.entries.length);assert.ok(converted.some(c=>c.e.row.category==='人文历史'&&c.body.document));assert.ok(converted.every(c=>c.e.row.visibility!=='private'));assert.ok(converted.find(c=>c.e.type==='article').body.text.includes('奥匈'));
  const bad=structuredClone(plan);bad.entries[0].source_sha256='b'.repeat(64);let calls=0;await assert.rejects(Legacy_Import(bad,{owner:user,DOMParser:dom.window.DOMParser,adapter:{preflight:async()=>calls++}}),/plan changed/);assert.equal(calls,0);
 }finally{dom.window.close();}
});
test('Publisher mapped legacy preserves URLs/dates/featured and replaces exactly one card; source collisions fail before mutations',async()=>{
 const root=new URL('../',import.meta.url),dir=await mkdtemp(tmpdir()+'/legacy-publisher-'),f=fixture();try{await Fixture_CopySite(root,dir);
  const plan=await Legacy_Plan(dir),e=plan.entries.find(e=>e.type==='article'),row=f.rows[0];row.slug=e.target_id;row.featured=true;row.legacy={target_type:'post',target_id:e.target_id,source_sha256:e.source_sha256,published_at:e.published_at};
  const result=await reconcile({adapter:f.adapter,directory:dir});const posts=publicData.mergePosts(plan.entries.filter(e=>e.type==='article').map(e=>e.row),result.snapshot);assert.equal(posts.filter(p=>p.slug===row.slug).length,1);const mapped=posts.find(p=>p.slug===row.slug);assert.equal(mapped.date,e.row.date);assert.equal(mapped.featured,true);assert.equal(mapped.community,false);
  const previous=await readFile(dir+'/data/community-public.json','utf8'),uploads=f.calls.filter(c=>c[0]==='upload').length;row.legacy.source_sha256='b'.repeat(64);await assert.rejects(reconcile({adapter:f.adapter,directory:dir}),/INVALID_SNAPSHOT/);assert.equal(await readFile(dir+'/data/community-public.json','utf8'),previous);assert.equal(f.calls.filter(c=>c[0]==='upload').length,uploads);
 }finally{await rm(dir,{recursive:true,force:true});}
});
