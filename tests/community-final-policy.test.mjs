import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,seedActors,asActor,actors,modulePath} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
const {user,other,admin,admin2}=actors;
function api(db){
 const run=(id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
 return {run,cycle:(type,n)=>run(admin,'select community_set_review_cycle($1,$2,$3)',[user,type,n]),
 draft:async(type='article',item=null)=>{item=item||(await run(user,'select community_create_item($1,$2) id',[type,'cycle-'+randomUUID()])).rows[0].id;
  const body=type==='album'?{description:'safe album',photos:[]}:{text:'safe text'};
  if(type==='album'){
   const p=user+'/'+randomUUID()+'.png';await run(user,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,'{\"mimetype\":\"image/png\",\"size\":10}')",[p]);
   body.photos=[{asset_id:(await run(user,'select community_register_asset($1,$2) id',[p,'photo.png'])).rows[0].id}];
  }
  return {item,revision:(await run(user,'select community_save_revision($1,$2,$3) id',[item,'Safe title',body])).rows[0].id};},
 submit:r=>run(user,'select community_submit_revision($1)',[r]),
 review:(r,d='approved',reason=null)=>run(admin,'select community_review_revision($1,$2,$3)',[r,d,reason]),
 state:async r=>(await db.query('select status from content_revisions where id=$1',[r])).rows[0].status,
 count:async type=>Number((await run(admin,'select * from community_review_cycle_status($1)',[user])).rows.find(r=>r.content_type===type).first_publish_count)};
}
async function lifecycle(db){
 await seedActors(db);const c=api(db);
 for(const [type,n] of [['article',3],['moment',2],['album',1]]){
  await c.cycle(type,n);
  for(let k=1;k<=n*2;k++){
   const a=await c.draft(type);assert.equal(await c.count(type),k-1);await c.submit(a.revision);
   assert.equal(await c.state(a.revision),k%n===0?'pending':'approved');
   await assert.rejects(c.submit(a.revision),/Only a newer draft/);
   if(k%n===0)await c.review(a.revision);
   assert.equal(await c.count(type),k);
   const edit=await c.draft(type,a.item);await c.submit(edit.revision);assert.equal(await c.state(edit.revision),'pending');
   await c.review(edit.revision,'returned','Please improve');assert.equal(await c.count(type),k);
   assert.equal((await db.query('select published_revision_id from content_items where id=$1',[a.item])).rows[0].published_revision_id,a.revision);
  }
 }
 await c.cycle('article',1);const gate=await c.draft(),queued=await c.draft();await c.submit(gate.revision);await c.submit(queued.revision);
 await assert.rejects(c.review(queued.revision),/earlier review gate/);
 await c.review(gate.revision,'returned','Fix sources');const again=await c.draft('article',gate.item);await c.submit(again.revision);assert.equal(await c.state(again.revision),'pending');
 await c.review(again.revision,'trashed','Reject');assert.equal(await c.count('article'),6);
 await assert.rejects(c.submit((await c.draft('article',gate.item)).revision),/Restore from trash/);
 await c.cycle('article',3);const debt=await c.draft();await c.submit(debt.revision);assert.equal(await c.state(debt.revision),'pending');
 await c.review(debt.revision);assert.equal(await c.count('article'),7);
 await c.run(admin,'select community_restore_revision($1)',[again.revision]);const restored=await c.draft('article',gate.item);await c.submit(restored.revision);assert.equal(await c.state(restored.revision),'pending');await c.review(restored.revision);
 assert.equal(await c.count('article'),8);
 // Trash a rejected edit: public safe snapshot and historical count remain intact.
 const badEdit=await c.draft('article',gate.item);await c.submit(badEdit.revision);await c.review(badEdit.revision,'trashed','Bad edit');
 assert.equal((await db.query('select published_revision_id from content_items where id=$1',[gate.item])).rows[0].published_revision_id,restored.revision);
 assert.equal(await c.count('article'),8);
 await c.run(admin,'select community_set_featured($1,true)',[gate.item]);await c.run(admin2,'select community_set_featured($1,true)',[gate.item]);
 assert.equal(Number((await db.query("select count(*) n from notifications where type='content_featured' and target_id=$1",[gate.item])).rows[0].n),1);
 await c.run(admin,'select community_set_featured($1,false)',[gate.item]);await c.run(admin,'select community_set_featured($1,true)',[gate.item]);
 assert.equal(Number((await db.query("select count(*) n from notifications where type='content_featured' and target_id=$1",[gate.item])).rows[0].n),2);
 for(const actor of [null,user,other])for(const sql of ['select community_set_featured($1,true)','select community_restore_revision($1)'])await assert.rejects(c.run(actor,sql,[gate.item]),/permission denied|Admin required/);
 for(const table of ['content_review_cycles','content_first_publications','content_revision_trash','community_management_audit'])await assert.rejects(c.run(user,'delete from '+table),/permission denied/);
 for(const n of [0,null,-1,10001])await assert.rejects(c.cycle('article',n),/Cycle must/);
 const own=(await c.run(admin,"select community_create_item('article',$1) id",['admin-'+randomUUID()])).rows[0].id;
 const ownR=(await c.run(admin,'select community_save_revision($1,$2,$3) id',[own,'Admin',{text:'admin'}])).rows[0].id;await c.run(admin,'select community_submit_revision($1)',[ownR]);assert.equal(await c.state(ownR),'approved');
 await assert.rejects(c.run(admin,'select community_set_user_review_threshold($1,$2,$3)',[user,'article',0]),/Obsolete threshold/);
 // An owner cannot erase their cumulative history or directly forge a role/state.
 await assert.rejects(c.run(user,'delete from content_items where id=$1',[gate.item]),/permission denied/);
 await assert.rejects(c.run(user,'update content_items set featured=true where id=$1',[gate.item]),/permission denied/);
}
test('Final periodic review: N=1/2/3, type isolation, immutable counts, review gate, three outcomes, trash restoration and featured ACLs',{skip:!modulePath},async()=>{const db=await createDatabase();try{await lifecycle(db);}finally{await db.close();}});
test('Final native PostgreSQL: periodic lifecycle and RLS',{skip:!nativeConfigured},async()=>{const db=await createNativeDatabase();try{await lifecycle(db);}finally{await db.close();}});
test('Final native PostgreSQL: concurrent submissions serialize per user/type; two reviewers increment exactly once',{skip:!nativeConfigured},async()=>{
 const db=await createNativeDatabase();try{
  await seedActors(db);const c=api(db);await c.cycle('article',2);const a=await c.draft(),b=await c.draft();
  async function connect(id){const p=await db.connect();await p.query('begin');await p.query('set local role authenticated');await p.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return p;}
  async function waitLock(){for(let k=0;k<100;k++){if((await db.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock'")).rows[0].n>0)return;await new Promise(r=>setTimeout(r,20));}assert.fail('No real lock contention');}
  const one=await connect(user),two=await connect(user);await one.query('select community_submit_revision($1)',[a.revision]);const second=two.query('select community_submit_revision($1)',[b.revision]);
  // Wait for real contention between independent transactions before releasing the lock.
  await waitLock();await one.query('commit');await second;await two.query('commit');
  assert.equal(await c.state(a.revision),'approved');assert.equal(await c.state(b.revision),'pending');assert.equal(await c.count('article'),1);
  const r1=await connect(admin),r2=await connect(admin2);await r1.query("select community_review_revision($1,'approved',null)",[b.revision]);
  const contention=r2.query("select community_review_revision($1,'approved',null)",[b.revision]).then(()=>null,e=>e);
  await waitLock();await r1.query('commit');assert.match((await contention).message,/Only a pending/);await r2.query('rollback');assert.equal(await c.count('article'),2);
 }finally{await db.close();}
});
