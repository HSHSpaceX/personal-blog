import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNativeDatabase, nativeConfigured } from './helpers/native-postgres.mjs';
import { asActor, seedActors, actors } from './helpers/postgres.mjs';
const {user,other,admin,admin2}=actors;
const options={skip:!nativeConfigured&&'Set PG_TEST_BIN and PG_TEST_MODULE for native PostgreSQL, including multi-connection races.'};
function suite(db){
 let count=0;
 const run=(id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
 const eq=(a,b)=>{assert.deepEqual(a,b);count++;};
 const denied=async(id,sql,args=[],pattern=/permission denied|row-level security|unavailable|Admin required/)=>{await assert.rejects(run(id,sql,args),pattern);count++;};
 const rows=async(id,sql,args=[],n=0)=>{const r=await run(id,sql,args);eq(r.rows.length,n);return r.rows;};
 const item=async(id,type='article')=>(await run(id,'select public.community_create_item($1,$2) as id',[type,'c-'+randomUUID()])).rows[0].id;
 const save=async(id,i,body={text:'safe text'},title='Title')=>(await run(id,'select public.community_save_revision($1,$2,$3) as id',[i,title,body])).rows[0].id;
 const submit=(id,r)=>run(id,'select public.community_submit_revision($1)',[r]);
 const review=(id,r,d='approved',why=null)=>run(id,'select public.community_review_revision($1,$2,$3)',[r,d,why]);
 const state=async(r)=>(await db.query('select status from public.content_revisions where id=$1',[r])).rows[0].status;
 const upload=async(id,mime='image/png')=>{
   const objectPath=id+'/'+randomUUID()+'.'+({'image/png':'png','text/plain':'txt'}[mime]);
   const obj=(await run(id,"insert into storage.objects(bucket_id,name,metadata) values ('community-assets',$1,$2) returning id",[objectPath,{mimetype:mime,size:10}])).rows[0].id;
   const asset=(await run(id,'select public.community_register_asset($1,$2) as id',[objectPath,'safe-file'])).rows[0].id;
   return {obj,asset,objectPath};
 };
 return {run,eq,denied,rows,item,save,submit,review,state,upload,report:label=>console.log(label+': '+count+' assertions passed.')};
}
test('Round 2 native PostgreSQL: thresholds apply only to new user content; admin authoring and immutable audits',options,async()=>{
 const db=await createNativeDatabase();
 try{await seedActors(db);const c=suite(db);
  c.eq((await c.run(user,'select public.is_admin() as admin')).rows[0].admin,false);
  await c.denied(null,"select public.community_create_item('article','guest')");
  await c.denied(user,"update public.user_roles set role='admin' where user_id=$1",[user]);
  await c.denied(admin,"update public.user_roles set role='admin' where user_id=$1",[user]);
  const first=await c.item(user),v1=await c.save(user,first);await c.submit(user,v1);c.eq(await c.state(v1),'pending');
  for(const id of [null,other])await c.rows(id,'select * from public.content_revisions where id=$1',[v1],0);
  await c.denied(other,'select public.community_save_revision($1,$2,$3)',[first,'attack',{text:'attack'}]);
  await c.denied(other,'select public.community_submit_revision($1)',[v1]);
  await c.denied(user,'select public.community_review_revision($1,$2,$3)',[v1,'approved',null]);
  await c.denied(user,'select public.community_set_user_review_threshold($1,$2,$3)',[user,'article',0]);
  await c.denied(admin,'select public.community_set_review_policy($1,$2)',['article',false]);
  await c.denied(user,'update public.user_review_thresholds set manual_approvals_required=0');
  await c.denied(user,'insert into public.content_approval_credits(item_id,user_id,content_type) values($1,$2,$3)',[first,user,'article']);
  await c.run(admin,'select public.community_set_user_review_threshold($1,$2,$3)',[user,'article',2]);
  await c.review(admin2,v1);c.eq(await c.state(v1),'approved');
  const second=await c.item(user),v2=await c.save(user,second);await c.submit(user,v2);c.eq(await c.state(v2),'pending');await c.review(admin,v2);
  const third=await c.item(user),v3=await c.save(user,third);await c.submit(user,v3);c.eq(await c.state(v3),'approved');
  c.eq((await c.rows(user,'select decision_source,reviewer_id from public.content_reviews where revision_id=$1',[v3],1))[0],{decision_source:'policy',reviewer_id:null});
  const policy=(await c.run(admin,'select * from public.community_review_policy_status($1)',[user])).rows.find(r=>r.content_type==='article');
  c.eq(Number(policy.approved_new_count),2);c.eq(policy.manual_approvals_required,2);
  // Edits remain pending despite trust and despite a zero threshold.
  const edit=await c.save(user,first,{text:'edited text'});await c.submit(user,edit);c.eq(await c.state(edit),'pending');
  c.eq((await c.rows(null,'select published_revision_id from public.content_items where id=$1',[first],1))[0].published_revision_id,v1);
  for(const reason of [null,' ','x'.repeat(2001)])await c.denied(admin,'select public.community_review_revision($1,$2,$3)',[edit,'rejected',reason],/Invalid review/);
  const reason='Needs sources <img src=x onerror=alert(1)> '+'r'.repeat(600);
  await c.review(admin2,edit,'rejected',reason);
  c.eq((await c.rows(user,'select rejection_reason from public.content_revisions where id=$1',[edit],1))[0].rejection_reason,reason);
  for(const id of [null,other])await c.rows(id,'select * from public.content_revisions where id=$1',[edit],0);
  await c.rows(other,'select * from public.content_reviews where revision_id=$1',[edit],0);
  const notice=(await c.rows(user,"select type,body,revision_id from public.notifications where revision_id=$1",[edit],1))[0];
  c.eq(notice,{type:'content_rejected',body:reason,revision_id:edit});
  await c.rows(other,'select * from public.notifications where revision_id=$1',[edit],0);
  await c.denied(user,'select public.community_submit_revision($1)',[edit],/Only a newer draft/);
  const reedit=await c.save(user,first,(await c.run(user,'select body from public.content_revisions where id=$1',[edit])).rows[0].body);
  c.eq(await c.state(reedit),'draft');await c.submit(user,reedit);c.eq(await c.state(reedit),'pending');await c.review(admin,reedit);
  c.eq((await c.rows(null,'select published_revision_id from public.content_items where id=$1',[first],1))[0].published_revision_id,reedit);
  c.eq(Number((await c.run(admin,'select * from public.community_review_policy_status($1)',[user])).rows.find(r=>r.content_type==='article').approved_new_count),2);
  const anotherUser=await c.item(other),o=await c.save(other,anotherUser);await c.submit(other,o);c.eq(await c.state(o),'pending');
  const moment=await c.item(user,'moment'),m=await c.save(user,moment,{text:'moment'});await c.submit(user,m);c.eq(await c.state(m),'pending');
  await c.run(admin,'select public.community_set_user_review_threshold($1,$2,$3)',[user,'moment',0]);
  c.eq(await c.state(m),'pending'); // rules do not retroactively approve pending decisions.
  const m2=await c.save(user,await c.item(user,'moment'),{text:'new moment'});await c.submit(user,m2);c.eq(await c.state(m2),'approved');
  const mEdit=await c.save(user,(await db.query('select item_id from public.content_revisions where id=$1',[m2])).rows[0].item_id,{text:'changed'});await c.submit(user,mEdit);c.eq(await c.state(mEdit),'pending');
  await c.run(admin2,'select public.community_set_user_review_threshold($1,$2,$3)',[user,'article',null]);
  const forever=await c.save(user,await c.item(user));await c.submit(user,forever);c.eq(await c.state(forever),'pending');
  for(const who of [admin,admin2]){
   const own=await c.item(who),a=await c.save(who,own);await c.submit(who,a);c.eq(await c.state(a),'approved');
   const a2=await c.save(who,own,{text:'admin edit'});await c.submit(who,a2);c.eq(await c.state(a2),'approved');
   c.eq((await c.rows(who,'select decision_source,reviewer_id from public.content_reviews where revision_id=$1',[a2],1))[0],{decision_source:'admin_auto',reviewer_id:who});
   await c.rows(who,'select * from public.notifications where revision_id in ($1,$2)',[a,a2],0);
  }
  for(const table of ['content_items','content_revisions','content_reviews','revision_assets','user_assets','user_review_thresholds','content_approval_credits']){
   const column=({content_items:'slug',content_revisions:'title',content_reviews:'status',revision_assets:'asset_id',user_assets:'original_name',user_review_thresholds:'content_type',content_approval_credits:'content_type'})[table];
   for(const who of [user,admin]){
    await c.denied(who,`insert into public.${table} default values`);
    await c.denied(who,`update public.${table} set ${column}=${column}`);
    await c.denied(who,`delete from public.${table}`);await c.denied(who,`truncate public.${table}`);
   }
  }
  c.report('Round 2 policy/RLS/audit/notification');
 }finally{await db.close();}
});
test('Round 2 native PostgreSQL: strict body schemas, private Storage, references and immutable files',options,async()=>{
 const db=await createNativeDatabase();
 try{await seedActors(db);const c=suite(db),i=await c.item(user),file=await c.upload(user),otherFile=await c.upload(other);
  for(const body of [{text:'x',html:'<script>1</script>'},{text:'x',url:'javascript:1'},{text:'x',onerror:'alert(1)'},{text:'x',tags:['a'.repeat(31)]},{text:'x',tags:Array(11).fill('x')},{text:'x',asset_ids:Array(21).fill(file.asset)},{text:1},{text:''},{text:'a'.repeat(100001)},{text:'x'+' '.repeat(100000)},{text:'x',tags:['x'+' '.repeat(30)]},{text:'x',asset_ids:['not-uuid']},{text:'x',asset_ids:[file.asset,file.asset]}])
    await c.denied(user,'select public.community_save_revision($1,$2,$3)',[i,'invalid',body],/Invalid|Duplicate/);
  await c.denied(user,'select public.community_save_revision($1,$2,$3)',[i,'x'+' '.repeat(160),{text:'x'}],/Invalid content title/);
  await c.denied(user,'select public.community_save_revision($1,$2,$3)',[i,'attack',{text:'x',asset_ids:[otherFile.asset]}]);
  const moment=await c.item(user,'moment');await c.denied(user,'select public.community_save_revision($1,$2,$3)',[moment,'invalid',{text:'x',summary:'not allowed'}],/Invalid/);
  await c.denied(user,'select public.community_save_revision($1,$2,$3)',[moment,'invalid',{text:'x'.repeat(2001)}],/Invalid/);
  const album=await c.item(user,'album');for(const body of [{photos:[]},{photos:[{asset_id:file.asset,url:'javascript:x'}]},{photos:[{asset_id:file.asset,caption:'x'.repeat(201)}]}])
    await c.denied(user,'select public.community_save_revision($1,$2,$3)',[album,'invalid',body],/Invalid|album needs/);
  const textFile=await c.upload(user,'text/plain');await c.denied(user,'select public.community_save_revision($1,$2,$3)',[album,'invalid',{photos:[{asset_id:textFile.asset}]}],/must be images/);
  const photo=await c.save(user,album,{description:'Album',photos:[{asset_id:file.asset,caption:'safe caption'}]});
  await c.rows(user,'select * from public.revision_assets where revision_id=$1',[photo],1);
  await c.rows(other,'select * from public.revision_assets where revision_id=$1',[photo],0);
  await c.denied(null,'select * from public.revision_assets');
  const script='<script>alert(1)</script><img onerror=alert(1)> javascript:alert(1)';
  const text=await c.save(user,i,{text:script,asset_ids:[file.asset]});c.eq((await c.rows(user,'select body from public.content_revisions where id=$1',[text],1))[0].body.text,script);
  // A pre-003 draft with a body-only asset UUID cannot evade new references.
  const oldItem=await c.item(user);
  const oldDraft=(await db.query('insert into public.content_revisions(item_id,revision_no,title,body) values($1,1,$2,$3) returning id',[oldItem,'Old draft',{text:'old',asset_ids:[file.asset]}])).rows[0].id;
  await c.denied(user,'select public.community_submit_revision($1)',[oldDraft],/Invalid revision asset references/);
  // Even broad permissive policies cannot defeat our restrictive bucket guards.
  await db.exec('create policy test_broad_storage on storage.objects for all to anon,authenticated using(true) with check(true)');
  for(const who of [user,admin,admin2])await c.rows(who,'select * from storage.objects where id=$1',[file.obj],1);
  for(const who of [null,other])await c.rows(who,'select * from storage.objects where id=$1',[file.obj],0);
  await c.rows(other,'select * from public.user_assets where id=$1',[file.asset],0);
  await c.denied(null,'select * from public.user_assets');
  for(const who of [null,other])await c.denied(who,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2)",[user+'/'+randomUUID()+'.png',{mimetype:'image/png',size:1}]);
  await c.denied(other,'select public.community_register_asset($1,$2)',[file.objectPath,'forged']);
  await c.denied(user,'insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes) values($1,$2,$3,$4,1)',[other,other+'/forged.png','fake','image/png']);
  for(const who of [other,admin])await c.rows(who,'delete from storage.objects where id=$1 returning id',[file.obj],0);
  await c.rows(user,"update storage.objects set metadata='{}' where id=$1 returning id",[file.obj],0);
  await assert.rejects(db.query("update storage.objects set metadata='{}' where id=$1",[file.obj]),/immutable/);
  for(const state of ['draft','pending','approved']){
   if(state==='pending')await c.submit(user,text);if(state==='approved')await c.review(admin,text);
   await c.denied(user,'delete from storage.objects where id=$1',[file.obj],/foreign key constraint/);
   await c.rows(user,'select * from storage.objects where id=$1',[file.obj],1);
  }
  c.eq((await db.query("select public from storage.buckets where id='community-assets'")).rows[0].public,false);
  await c.rows(user,'delete from storage.objects where id=$1 returning id',[textFile.obj],1);
  await c.rows(user,'select * from public.user_assets where id=$1',[textFile.asset],0);
  await c.denied(user,'select public.community_register_asset($1,$2)',[textFile.objectPath,'missing'],/Upload/);
  // Deferred reference FK allows a complete Auth account cascade, while objects
  // remain unregistered private orphans for a future Storage cleanup job.
  await db.query('delete from auth.users where id=$1',[user]);
  c.eq((await db.query('select count(*)::int as n from public.content_items where author_id=$1',[user])).rows[0].n,0);
  c.eq((await db.query('select count(*)::int as n from public.user_assets where owner_id=$1',[user])).rows[0].n,0);
  c.report('Round 2 schemas/Storage/references');
 }finally{await db.close();}
});
async function actorConnection(db,id){const client=await db.connect();await client.query('begin');await client.query('set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return client;}
async function waitForLock(db,pid){for(let i=0;i<100;i++){const r=await db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}assert.fail('Second connection did not actually wait on a PostgreSQL lock');}
test('Round 2 native PostgreSQL: two admins concurrently decide exactly once; saving a reference races safely with deletion',options,async()=>{
 const db=await createNativeDatabase();
 try{await seedActors(db);const c=suite(db),i=await c.item(user),r=await c.save(user,i);await c.submit(user,r);
  const one=await actorConnection(db,admin),two=await actorConnection(db,admin2);
  const pid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
  await one.query("select public.community_review_revision($1,'approved',null)",[r]);
  const contender=two.query("select public.community_review_revision($1,'rejected','Concurrent reject')",[r]).then(()=>({ok:true}),error=>({error}));
  await waitForLock(db,pid);await one.query('commit');const result=await contender;
  assert.match(result.error?.message||'',/Only a pending/);await two.query('rollback');
  c.eq(await c.state(r),'approved');await c.rows(user,'select * from public.notifications where revision_id=$1',[r],1);
  const asset=await c.upload(user),save=await actorConnection(db,user),remove=await actorConnection(db,user);
  const deletePid=(await remove.query('select pg_backend_pid() as pid')).rows[0].pid;
  await save.query('select public.community_save_revision($1,$2,$3)',[i,'Asset race',{text:'x',asset_ids:[asset.asset]}]);
  const deletion=remove.query('delete from storage.objects where id=$1',[asset.obj]).then(()=>remove.query('commit')).then(()=>({ok:true}),error=>({error}));
  await waitForLock(db,deletePid);await save.query('commit');const deleted=await deletion;
  assert.match(deleted.error?.message||'',/foreign key constraint/);await remove.query('rollback');
  await c.rows(user,'select * from storage.objects where id=$1',[asset.obj],1);
  await c.rows(user,'select * from public.user_assets where id=$1',[asset.asset],1);
  c.report('Round 2 actual concurrent connections');
 }finally{await db.close();}
});
