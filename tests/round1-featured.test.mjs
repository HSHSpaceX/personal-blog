import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createDatabase,modulePath,actors,seedActors,asActor} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {desiredSnapshot} from '../scripts/sync-community-public.mjs';
const run=(db,id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
async function service(db,sql,args=[]){await db.exec('begin;set local role service_role');try{const r=await db.query(sql,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
async function article(db,author,title){const item=(await run(db,author,'select public.community_create_item($1,$2) as id',['article','round1-'+randomUUID()])).rows[0].id;const revision=(await run(db,author,'select public.community_save_revision($1,$2,$3) as id',[item,title,{text:'精选专项正文',category:'杂谈'}])).rows[0].id;return {item,revision};}
for(const [engine,configured,create]of [['PGlite',modulePath,createDatabase],['native PostgreSQL',nativeConfigured,createNativeDatabase]]){
 test('Round 1 '+engine+': featured authority, persistence, event notifications, admin self-publish and Publisher export',{skip:!configured&&'Configure isolated '+engine},async(t)=>{
  const db=await create();try{
   await seedActors(db);const a=await article(db,actors.user,'普通作者精选文章');
   for(const id of [null,actors.user,actors.other])await assert.rejects(run(db,id,'select public.community_set_featured($1,true)',[a.item]),/Admin required|permission denied/);
   await assert.rejects(run(db,actors.admin,'select public.community_set_featured($1,true)',[a.item]),/Published article required/);
   await assert.rejects(run(db,actors.user,'update public.content_items set featured=true where id=$1',[a.item]),/permission denied/);
   await assert.rejects(run(db,actors.user,'select public.community_save_revision($1,$2,$3)',[a.item,'非法提前精选',{text:'x',featured:true}]),/Invalid|Unsupported|Unknown|字段|body/i);
   await run(db,actors.user,'select public.community_submit_revision($1)',[a.revision]);assert.equal((await run(db,actors.user,'select status from public.content_revisions where id=$1',[a.revision])).rows[0].status,'pending');
   await run(db,actors.admin,'select public.community_review_revision($1,$2,$3)',[a.revision,'approved',null]);
   const published=await run(db,actors.admin,"select id,featured from public.content_items where content_type='article' and published_revision_id is not null");assert.ok(published.rows.some(r=>r.id===a.item));
   await run(db,actors.admin,'select public.community_set_featured($1,true)',[a.item]);assert.equal((await run(db,actors.admin,'select featured from public.content_items where id=$1',[a.item])).rows[0].featured,true);
   const notices=()=>run(db,actors.user,"select * from public.notifications where type='content_featured' order by id");let n=(await notices()).rows;assert.equal(n.length,1);assert.equal(n[0].revision_id,a.revision);assert.equal(n[0].target_id,a.item);assert.equal(n[0].user_id,actors.user);assert.equal(n[0].title,'文章已入选精选');
   const pageNotice=(await run(db,actors.user,'select public.notifications_page(20,0) as notice')).rows.map(r=>r.notice).find(r=>r.type==='content_featured');assert.equal(pageNotice.target_kind,'article');assert.ok(pageNotice.target_slug.startsWith('round1-'));assert.equal(pageNotice.revision_id,a.revision);assert.equal(pageNotice.title,'文章已入选精选');assert.equal(pageNotice.body,'你的文章《普通作者精选文章》已被选为精选文章。');
   await run(db,actors.admin,'select public.community_set_featured($1,true)',[a.item]);assert.equal((await notices()).rows.length,1);
   await run(db,actors.admin,'select public.community_set_featured($1,false)',[a.item]);assert.equal((await run(db,actors.admin,'select featured from public.content_items where id=$1',[a.item])).rows[0].featured,false);assert.equal((await notices()).rows.length,1);
   await run(db,actors.admin,'select public.community_set_featured($1,true)',[a.item]);assert.equal((await notices()).rows.length,2);
   let exported=(await service(db,'select public.community_publication_export() as snapshot')).rows[0].snapshot;assert.equal(exported.find(r=>r.id===a.item).featured,true);const firstDate=exported.find(r=>r.id===a.item).published_at;
   const edit=(await run(db,actors.user,'select public.community_save_revision($1,$2,$3) as id',[a.item,'修改后的精选文章',{text:'更新正文'}])).rows[0].id;await run(db,actors.user,'select public.community_submit_revision($1)',[edit]);await run(db,actors.admin,'select public.community_review_revision($1,$2,$3)',[edit,'approved',null]);
   exported=(await service(db,'select public.community_publication_export() as snapshot')).rows[0].snapshot;assert.equal(exported.find(r=>r.id===a.item).published_at,firstDate,'editing must preserve first publication date');
   const own=await article(db,actors.admin,'管理员直接发表');await run(db,actors.admin,'select public.community_submit_revision($1)',[own.revision]);assert.equal((await run(db,actors.admin,'select status from public.content_revisions where id=$1',[own.revision])).rows[0].status,'approved');const autoReview=(await db.query('select * from public.content_reviews where revision_id=$1',[own.revision])).rows;assert.equal(autoReview.length,1);assert.equal(autoReview[0].status,'approved');assert.equal(autoReview[0].decision_source,'admin_auto');
   await run(db,actors.admin,'select public.community_set_featured($1,true)',[own.item]);exported=(await service(db,'select public.community_publication_export() as snapshot')).rows[0].snapshot;assert.equal(exported.find(r=>r.id===own.item).featured,true);assert.equal((await run(db,actors.admin,"select * from public.notifications where type='content_featured'")).rows.length,0,'no self notification');
   const {snapshot}=await desiredSnapshot(exported,{publicURL:()=>{throw Error('No media needed');}});assert.equal(snapshot.items.find(r=>r.id===own.item).featured,true);assert.equal((await run(db,actors.admin,'select status from public.community_publication_state where item_id=$1',[own.item])).rows[0].status,'pending');
   await run(db,actors.admin,'select public.community_set_featured($1,false)',[a.item]);exported=(await service(db,'select public.community_publication_export() as snapshot')).rows[0].snapshot;assert.equal(exported.find(r=>r.id===a.item).featured,false);
  }finally{await db.close();}
 });
}
test('Round 1 Publisher missing configuration fails before network or public file mutation',async()=>{
 const files=['data/community-public.json','js/community-published.js','data/site-settings-public.json'],hash=async()=>Promise.all(files.map(async file=>{try{return createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');}catch(e){if(e.code==='ENOENT')return null;throw e;}})),before=await hash();
 const result=spawnSync(process.execPath,['scripts/sync-community-public.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/Publication failed: EXPORT_FAILED/);assert.match(result.stderr,/configuration missing: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);assert.deepEqual(await hash(),before);
});

test('Round 1 management cards distinguish deployed public, new private drafts and repository sync without early deployment claims',{skip:!process.env.COMMUNITY_DOM_MODULE&&'Configure jsdom.'},async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
 try{w.eval(await readFile(new URL('../js/content-cards.js',import.meta.url),'utf8'));const item={id:actors.user,content_type:'article',community_publication_state:{status:'published',published_revision_id:actors.other}},revision={id:actors.other,title:'<script>文章</script>',status:'approved',created_at:'2026-10-10T00:00:00Z'};
  let card=w.ContentCards.card(item,revision).element;assert.equal(card.dataset.contentState,'synced');assert.match(card.textContent,/等待部署/);assert.equal(card.querySelector('script'),null);
  w.COMMUNITY_PUBLIC={items:[{id:item.id,revision_id:revision.id,body:{summary:'当前部署正文'}}]};card=w.ContentCards.card(item,revision).element;assert.equal(card.dataset.contentState,'public');assert.match(card.textContent,/已公开/);
  for(const status of ['draft','pending','approved','rejected']){const newer={...revision,id:actors.admin,status};card=w.ContentCards.card(item,newer).element;assert.equal(card.dataset.contentState,status);assert.match(card.textContent,/已有公开版本仍可见/);}
  item.community_publication_state={status:'failed',last_error:'EXPORT_FAILED'};card=w.ContentCards.card(item,{...revision,id:actors.admin}).element;assert.equal(card.dataset.contentState,'failed');assert.match(card.textContent,/发布失败/);
 }finally{dom.window.close();}
});
