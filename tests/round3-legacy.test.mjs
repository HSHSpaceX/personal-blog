import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {seedActors,actors,asActor} from './helpers/postgres.mjs';
import {Fixture_CopySite} from './helpers/site-fixture.mjs';
import {Legacy_Plan,Legacy_Import,Legacy_ServiceAdapter} from '../scripts/legacy-community-import.mjs';
import {desiredSnapshot} from '../scripts/sync-community-public.mjs';
import publicData from '../js/community-public.js';
const run=(db,id,sql,args=[])=>asActor(db,'authenticated',id,sql,args);
async function Legacy_Service(db,sql,args=[]){await db.exec('begin;set local role service_role');try{const r=await db.query(sql,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('Round 3 native legacy rehearsal: interrupted media upload, retry, two identical imports and author revision/review/export',{skip:!nativeConfigured||!process.env.COMMUNITY_DOM_MODULE},async()=>{
 const db=await createNativeDatabase({compatible:true}),{JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('');try{
  await seedActors(db);await db.query('update community_publication_config set legacy_author_id=$1 where singleton',[actors.user]);
  const plan=await Legacy_Plan(),files=new Map();let fail=true;
  const adapter={preflight:async(entries,owner)=>{const ready=(await Legacy_Service(db,'select community_release_preflight() r')).rows[0].r;assert.equal(ready.legacy_owner_id,owner);},
   upload:async(name,bytes,mime)=>{if(fail&&files.size===1){fail=false;throw Error('Fixture network interruption');}if(files.has(name)){assert.deepEqual(files.get(name),bytes);return;}files.set(name,bytes);await db.query("insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2)",[name,{mimetype:mime,size:bytes.length}]);},
   register:async(owner,a)=>(await Legacy_Service(db,'select community_register_legacy_asset($1,$2,$3,$4,$5) id',[owner,a.object_path,a.original_name,a.mime_type,a.size_bytes])).rows[0].id,
   import:async(owner,e,body)=>(await Legacy_Service(db,'select community_import_legacy($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[owner,e.type,e.slug,e.target_id,e.source_sha256,e.row.title||'动态',body,e.published_at,!!e.row.featured])).rows[0].id};
  const options={owner:actors.user,DOMParser:dom.window.DOMParser,adapter};
  await assert.rejects(Legacy_Import(plan,options),/network interruption/);
  assert.equal((await db.query('select count(*)::int n from content_items')).rows[0].n,0);
  const first=await Legacy_Import(plan,options),mediaCount=files.size;
  assert.deepEqual(await Legacy_Import(plan,options),first);assert.equal(files.size,mediaCount);
  for(const table of ['content_items','content_revisions','community_legacy_mappings'])assert.equal((await db.query('select count(*)::int n from '+table)).rows[0].n,plan.entries.length);
  assert.equal((await db.query('select count(*)::int n from user_assets')).rows[0].n,mediaCount);
  let rows=(await Legacy_Service(db,'select community_publication_export() r')).rows[0].r;
  for(const entry of plan.entries){const row=rows.find(r=>r.legacy.target_id===entry.target_id);assert.ok(row);assert.equal(row.slug,entry.slug);assert.equal(row.featured,!!entry.row.featured);assert.equal(Date.parse(row.legacy.published_at),Date.parse(entry.published_at));assert.equal(row.author.username,(await db.query('select username from profiles where id=$1',[actors.user])).rows[0].username);}
  const {snapshot}=await desiredSnapshot(rows,{download:async p=>files.get(p),publicURL:p=>'https://fixture.supabase.invalid/storage/v1/object/public/published-media/'+p});
  const articles=plan.entries.filter(e=>e.type==='article');assert.equal(publicData.mergePosts(articles.map(e=>e.row),snapshot).length,articles.length);
  const row=rows.find(r=>r.content_type==='article'),revision=(await run(db,actors.user,'select community_save_revision($1,$2,$3) id',[row.id,'历史文章修改与重新审核',row.body])).rows[0].id;
  await run(db,actors.user,'select community_submit_revision($1)',[revision]);assert.equal((await Legacy_Service(db,'select community_publication_export() r')).rows[0].r.find(r=>r.id===row.id).revision_id,row.revision_id);
  await run(db,actors.admin,"select community_review_revision($1,'approved')",[revision]);rows=(await Legacy_Service(db,'select community_publication_export() r')).rows[0].r;
  const edited=rows.find(r=>r.id===row.id);assert.equal(edited.revision_id,revision);assert.deepEqual(edited.legacy,row.legacy);assert.equal(edited.featured,row.featured);
  const report={plan_digest:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),counts:Object.fromEntries(['article','moment','album'].map(t=>[t,plan.entries.filter(e=>e.type===t).length])),unique_media:mediaCount,imported_ids:first,interrupted_upload_retry:true,second_import_identical:true,author_edit_review_export:true,production_import:false};
  if(process.env.GUI_EVIDENCE_DIR){const directory=path.resolve(process.env.GUI_EVIDENCE_DIR,'..');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'legacy-native-rehearsal.json'),JSON.stringify(report,null,2));}
 }finally{dom.window.close();await db.close();}
});
test('Round 3 legacy failure guards: changed plan, owner mismatch, missing media, MIME and unresolved references stop before writes',{skip:!process.env.COMMUNITY_DOM_MODULE},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'round3-legacy-')),{JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('');try{
  await Fixture_CopySite(new URL('../',import.meta.url),directory);const plan=await Legacy_Plan(directory);let writes=0;
  const options={directory,owner:actors.user,DOMParser:dom.window.DOMParser,adapter:{preflight:async()=>{writes++;throw Error('Unexpected preflight');}}};
  const changed=structuredClone(plan);changed.entries[0].source_sha256='b'.repeat(64);await assert.rejects(Legacy_Import(changed,options),/plan changed/);
  await assert.rejects(Legacy_Import(plan,{...options,owner:'wrong'}),/Verified legacy owner/);
  const file=plan.entries[0].files[0].path,bytes=await readFile(path.join(directory,file));await rm(path.join(directory,file));await assert.rejects(Legacy_Import(plan,options),/ENOENT/);await writeFile(path.join(directory,file),Buffer.from('%PDF-1.7\ninvalid image'));
  await assert.rejects(Legacy_Plan(directory),/MIME conflict/);await writeFile(path.join(directory,file),bytes);
  const source=await readFile(path.join(directory,'js/posts.js'),'utf8');await writeFile(path.join(directory,'js/posts.js'),source.replace(/assets\/posts\/[^"']+/, 'assets/posts/missing-image.jpg'));await assert.rejects(Legacy_Plan(directory),/ENOENT/);assert.equal(writes,0);
 }finally{dom.window.close();await rm(directory,{recursive:true,force:true});}
});
test('Round 3 legacy service preflight rejects a wrong owner/slug and refuses to overwrite different existing bytes',async()=>{
 const entry=(await Legacy_Plan()).entries[0];let mode='owner',writes=0;
 const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 const adapter=Legacy_ServiceAdapter('https://fixture.invalid','fixture-only',async(url,options={})=>{
  if(url.pathname.endsWith('/community_release_preflight'))return response({version:20261013,legacy_owner_id:mode==='owner'?actors.other:actors.user});
  if(url.pathname.endsWith('/content_items'))return response([{id:actors.admin,author_id:actors.other,content_type:entry.type,slug:entry.slug}]);
  if(url.pathname.endsWith('/community_legacy_mappings'))return response([]);
  if(options.method==='POST')writes++;return new Response('different existing bytes',{status:200});
 });
 await assert.rejects(adapter.preflight([entry],actors.user),/verified legacy owner/);mode='slug';await assert.rejects(adapter.preflight([entry],actors.user),/conflict/);
 await assert.rejects(adapter.upload('fixture.png',Buffer.from('expected bytes'),'image/png'),/never overwrite/);assert.equal(writes,0);
});
