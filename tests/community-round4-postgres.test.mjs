import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {asActor,seedActors,actors} from './helpers/postgres.mjs';
const {user,other,admin,admin2}=actors;
const options={skip:!nativeConfigured&&'Set native PostgreSQL environment to execute Round 4 RLS.'};
function harness(db) {
 let n=0;
 const run=(id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
 const eq=(a,b)=>{assert.deepEqual(a,b);n++;};
 const denied=async(id,sql,args=[],pattern=/permission denied|unavailable|row-level security|Admin required|registered|cannot be deleted|foreign key/)=>{await assert.rejects(run(id,sql,args),pattern);n++;};
 const rows=async(id,sql,args=[],length=0)=>{const r=await run(id,sql,args);eq(r.rows.length,length);return r.rows;};
 const scalar=async(id,sql,args=[])=>(await run(id,sql,args)).rows[0];
 const thread=async(id,target)=>(await scalar(id,'select public.dm_get_or_create_thread($1) as id',[target])).id;
 const send=async(id,t,body='Private body',assets=[])=>(await scalar(id,'select public.dm_send_message($1,$2,$3) as id',[t,body,assets])).id;
 const object=async(id,mime='image/png',size=200,ext='png')=>{const name=id+'/'+randomUUID()+'.'+ext;const o=(await scalar(id,"insert into storage.objects(bucket_id,name,metadata) values('dm-media',$1,$2) returning id",[name,{mimetype:mime,size}])).id;return {id:o,name};};
 const asset=async(id,obj,name='image.png')=>(await scalar(id,'select public.dm_register_asset($1,$2) as id',[obj.name,name])).id;
 const comment=async(id,slug='post-austria-history',parent=null,status='pending')=>(await scalar(id,'insert into public.comments(user_id,post_slug,content,parent_id,status) values($1,$2,$3,$4,$5) returning id',[id,slug,'Comment body',parent,status])).id;
 const noticeCount=async(id,type)=>Number((await db.query('select count(*) as n from public.notifications where user_id=$1 and type=$2',[id,type])).rows[0].n);
 return {run,eq,denied,rows,scalar,thread,send,object,asset,comment,noticeCount,report:label=>console.log(label+': '+n+' assertions passed.')};
}
test('Round 4 DM: participants only including admin, immutable sender, stable pair, bounded history and race-safe unread cursors',options,async()=>{
 const db=await createNativeDatabase();try {
  await seedActors(db);const c=harness(db),third=randomUUID();await db.query('insert into auth.users(id) values($1)',[third]);
  const t=await c.thread(user,other);c.eq(await c.thread(other,user),t);c.eq(await c.thread(user,other),t);
  await c.denied(user,'select public.dm_get_or_create_thread($1)',[user],/yourself/);
  await c.denied(null,'select public.dm_get_or_create_thread($1)',[user]);
  await c.denied(user,'select public.dm_get_or_create_thread($1)',[randomUUID()]);
  await c.denied(user,'select public.dm_get_or_create_thread($1,$2)',[other,other],/account changed/);
  const first=await c.send(user,t,'<script>private</script>');await c.send(other,t,'Reply');
  await c.denied(user,'select public.dm_send_message($1,$2,$3,$4)',[t,'Wrong captured sender',[],other],/account changed/);
  await c.denied(user,'select public.dm_mark_thread_read($1,$2,$3)',[t,0,other],/account changed/);
  for(const outsider of [third,admin,admin2]) {
   await c.rows(outsider,'select * from public.dm_threads where id=$1',[t],0);
   await c.rows(outsider,'select * from public.dm_messages where id=$1',[first],0);
   await c.denied(outsider,'select * from public.dm_messages($1,20,null)',[t]);
   await c.denied(outsider,'select public.dm_send_message($1,$2,$3)',[t,'attack',[]]);
   await c.denied(outsider,'select public.dm_mark_thread_read($1)',[t]);
   await c.rows(outsider,'select * from public.dm_threads(20,0)',[],0);
  }
  for(const sql of ['select * from public.dm_threads','select * from public.dm_messages','select public.dm_unread_count()','select * from public.dm_threads(20,0)','select * from public.dm_messages($1,20,null)'])await c.denied(null,sql,sql.includes('$1')?[t]:[]);
  const functions=(await db.query("select proname,has_function_privilege('anon',p.oid,'EXECUTE') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'dm_%'")).rows;
  c.eq(functions.length>=14,true);c.eq(functions.every(f=>!f.anon),true);
  for(const who of [user,other,admin])for(const table of ['dm_threads','dm_messages','dm_assets','dm_message_assets']) {
   await c.denied(who,'insert into public.'+table+' default values');await c.denied(who,'update public.'+table+' set '+(table==='dm_threads'?'user_low=user_low':table==='dm_messages'?'sender_id=sender_id':table==='dm_assets'?'owner_id=owner_id':'message_id=message_id'));
   await c.denied(who,'delete from public.'+table);
  }
  for(const body of ['', ' '.repeat(10),'x'.repeat(4001),null])await c.denied(user,'select public.dm_send_message($1,$2,$3)',[t,body,[]],/Invalid message/);
  await c.send(user,t,'😀'.repeat(4000));
  for(const badLimit of [0,51,null])await c.denied(user,'select * from public.dm_messages($1,$2,null)',[t,badLimit],/Invalid page/);
  const page=await c.rows(other,'select * from public.dm_messages($1,2,null)',[t],2);c.eq(page.map(r=>Number(r.message_no)),[3,2]);
  const older=await c.rows(other,'select * from public.dm_messages($1,2,$2)',[t,page.at(-1).message_no],1);c.eq(older[0].id,first);
  c.eq(Number((await c.scalar(other,'select public.dm_unread_count() as n')).n),2);
  await c.run(other,'select public.dm_mark_thread_read($1,$2)',[t,1]);c.eq(Number((await c.scalar(other,'select public.dm_unread_count() as n')).n),1);
  await c.send(user,t,'Arrived after history was read');await c.run(other,'select public.dm_mark_thread_read($1,$2)',[t,3]);
  c.eq(Number((await c.scalar(other,'select public.dm_unread_count() as n')).n),1);
  await c.run(other,'select public.dm_mark_thread_read($1,$2)',[t,1]);c.eq(Number((await c.scalar(other,'select public.dm_unread_count() as n')).n),1);
  await c.denied(other,'select public.dm_mark_thread_read($1,$2)',[t,1000],/Invalid read cursor/);
  await c.run(other,'select public.dm_mark_thread_read($1)',[t]);c.eq(Number((await c.scalar(other,'select public.dm_unread_count() as n')).n),0);
  const adminThread=await c.thread(admin,user);await c.send(admin,adminThread,'Admin is an ordinary participant');
  await c.rows(admin,'select * from public.dm_messages($1,20,null)',[adminThread],1);await c.denied(admin2,'select * from public.dm_messages($1,20,null)',[adminThread]);
  c.eq((await db.query('select count(*)::int as n from public.notifications where user_id=actor_id')).rows[0].n,0);
  c.report('DM participant isolation/read cursors');
 } finally {await db.close();}
});
test('Round 4 private DM images: pre-send owner, post-send participants, immutable objects, metadata validation and Storage-only cleanup',options,async()=>{
 const db=await createNativeDatabase();try {
  await seedActors(db);const c=harness(db),third=randomUUID();await db.query('insert into auth.users(id) values($1)',[third]);
  const t=await c.thread(user,other),o=await c.object(user),a=await c.asset(user,o);
  for(const who of [other,third,admin,admin2]) {await c.rows(who,'select * from public.dm_assets where id=$1',[a],0);await c.rows(who,'select * from storage.objects where id=$1',[o.id],0);await c.denied(who,'select public.dm_prepare_asset_delete($1)',[a]);}
  await c.denied(null,'select * from public.dm_assets');await c.rows(null,'select * from storage.objects where id=$1',[o.id],0);
  await c.denied(other,'select public.dm_send_message($1,$2,$3)',[t,'Stolen attachment',[a]]);
  await c.denied(user,'select public.dm_send_message($1,$2,$3)',[t,'',[a,a]],/Invalid message/);
  await c.denied(user,'select public.dm_send_message($1,$2,$3)',[t,'',[null]],/Invalid message/);
  const mid=await c.send(user,t,'',[a]);
  await c.denied(user,"insert into storage.objects(bucket_id,name,metadata) values('dm-media',$1,$2)",[o.name,{mimetype:'image/png',size:200}],/duplicate key/);
  for(const who of [user,other]) {await c.rows(who,'select * from public.dm_assets where id=$1',[a],1);await c.rows(who,'select * from storage.objects where id=$1',[o.id],1);await c.rows(who,'select * from public.dm_message_assets where message_id=$1',[mid],1);}
  for(const who of [third,admin,admin2]) {await c.rows(who,'select * from public.dm_assets where id=$1',[a],0);await c.rows(who,'select * from storage.objects where id=$1',[o.id],0);await c.rows(who,'select * from public.dm_message_assets where message_id=$1',[mid],0);}
  await c.denied(user,'select public.dm_prepare_asset_delete($1)',[a]);await c.denied(user,'delete from storage.objects where id=$1',[o.id]);
  await c.rows(other,'delete from storage.objects where id=$1 returning id',[o.id],0);
  await c.rows(user,'update storage.objects set metadata=metadata where id=$1 returning id',[o.id],0);
  await assert.rejects(db.query('update storage.objects set metadata=metadata where id=$1',[o.id]),/immutable/);
  await c.denied(user,'select public.dm_send_message($1,$2,$3)',[t,'Again',[a]],/already sent/);
  for(const [mime,size,ext] of [['image/svg+xml',100,'png'],['text/html',100,'png'],['image/png',8388609,'png'],['image/png',0,'png'],['image/png',null,'png'],['image/png',10,'jpg'],['image/png','NaN','png']]) {
   const invalid=await c.object(user,mime,size,ext);await c.denied(user,'select public.dm_register_asset($1,$2)',[invalid.name,'bad'],/metadata/);
  }
  const own=await c.object(user);await c.denied(other,'select public.dm_register_asset($1,$2)',[own.name,'forged']);
  await c.denied(user,"insert into storage.objects(bucket_id,name,metadata) values('dm-media',$1,$2)",[other+'/'+randomUUID()+'.png',{mimetype:'image/png',size:200}]);
  for(const ext of ['svg','html'])await c.denied(user,"insert into storage.objects(bucket_id,name,metadata) values('dm-media',$1,$2)",[user+'/'+randomUUID()+'.'+ext,{}]);
  const unsent=await c.asset(user,own);await c.rows(user,'select * from public.dm_unsent_assets(20,0)',[],1);await c.rows(other,'select * from public.dm_unsent_assets(20,0)',[],0);
  await c.run(user,'select public.dm_prepare_asset_delete($1)',[unsent]);await c.rows(user,'delete from storage.objects where id=$1 returning id',[own.id],1);
  const orphan=await c.object(other);await c.denied(user,'select public.dm_prepare_orphan_delete($1)',[orphan.id]);await c.denied(admin,'select public.dm_prepare_orphan_delete($1)',[orphan.id]);
  await c.run(other,'select public.dm_prepare_orphan_delete($1)',[orphan.id]);const registered=await c.asset(other,orphan);
  await c.denied(other,'delete from storage.objects where id=$1',[orphan.id]);await c.run(other,'select public.dm_prepare_asset_delete($1)',[registered]);await c.rows(other,'delete from storage.objects where id=$1 returning id',[orphan.id],1);
  const four=[];for(let i=0;i<5;i++)four.push(await c.asset(user,await c.object(user)));
  await c.denied(user,'select public.dm_send_message($1,$2,$3)',[t,'five',four],/Invalid message/);await c.send(user,t,'four',four.slice(0,4));
  const adminT=await c.thread(admin,user),adminObj=await c.object(admin),adminAsset=await c.asset(admin,adminObj);await c.send(admin,adminT,'',[adminAsset]);
  await c.rows(user,'select * from storage.objects where id=$1',[adminObj.id],1);await c.rows(other,'select * from storage.objects where id=$1',[adminObj.id],0);
  c.eq((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='dm-media'")).rows[0],{public:false,file_size_limit:'8388608',allowed_mime_types:['image/jpeg','image/png','image/webp']});
  // Broad unrelated policies cannot override restrictive DM guards.
  await db.query('create policy test_broad_read on storage.objects for select to anon,authenticated using(true)');
  await c.rows(admin,'select * from storage.objects where id=$1',[o.id],0);await c.rows(null,'select * from storage.objects where id=$1',[o.id],0);
  c.report('DM Storage registry/ownership');
 }finally {await db.close();}
});
test('Round 4 notification events: initial rejection, published-only social events, trusted legacy authors and recipient-private pagination',options,async()=>{
 const db=await createNativeDatabase();try {
  await seedActors(db);const c=harness(db);
  const initial=await c.comment(user);
  await c.denied(admin,'select public.community_moderate_comment($1,$2,$3)',[initial,'rejected',null],/Invalid comment/);
  const reason='Needs evidence '+ 'x'.repeat(1900);
  await c.run(admin,'select public.community_moderate_comment($1,$2,$3)',[initial,'rejected',reason]);
  const result=await c.rows(user,'select rejection_reason from public.comment_review_results where comment_id=$1',[initial],1);c.eq(result[0].rejection_reason,reason);
  for(const who of [other])await c.rows(who,'select * from public.comment_review_results where comment_id=$1',[initial],0);
  await c.denied(null,'select * from public.comment_review_results');c.eq(await c.noticeCount(user,'comment_rejected'),1);
  c.eq((await c.rows(user,"select body from public.notifications where comment_id=$1 and type='comment_rejected'",[initial],1))[0].body,reason);
  c.eq((await c.rows(user,'select rejection_reason from public.community_my_comments(20,0)',[],1))[0].rejection_reason,reason);
  await c.run(user,'select public.community_edit_comment($1,$2)',[initial,'Rewritten']);await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[initial,'approved']);
  c.eq(await c.noticeCount(user,'comment_edit_approved'),1);c.eq(await c.noticeCount(user,'comment_approved'),1);
  const plain=await c.comment(user);await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[plain,'approved']);c.eq(await c.noticeCount(user,'comment_approved'),2);
  const revisedPending=await c.comment(user);const pendingEdit=(await c.scalar(user,'select public.community_edit_comment($1,$2) as id',[revisedPending,'Edited before first approval'])).id;
  await c.run(admin,'select public.community_review_comment_edit($1,$2,$3)',[pendingEdit,'rejected','Initial edited candidate rejected']);
  c.eq((await c.rows(user,'select rejection_reason from public.comment_review_results where comment_id=$1',[revisedPending],1))[0].rejection_reason,'Initial edited candidate rejected');
  c.eq(await c.noticeCount(user,'comment_rejected'),2);c.eq(await c.noticeCount(user,'comment_edit_rejected'),1);
  await c.comment(admin,'post-austria-history',null,'approved');c.eq(await c.noticeCount(admin,'comment_approved'),0);
  await db.query("update public.legacy_public_targets set author_id=$1 where target_type='post' and target_id='post-austria-history'",[admin]);
  const parent=await c.comment(admin,'post-austria-history',null,'approved');
  const reply=await c.comment(user,'post-austria-history',parent);c.eq(await c.noticeCount(admin,'comment_reply'),0);c.eq(await c.noticeCount(admin,'content_comment'),0);
  await c.run(admin2,'select public.community_moderate_comment($1,$2,$3)',[reply,'rejected','Not public']);c.eq(await c.noticeCount(admin,'comment_reply'),0);c.eq(await c.noticeCount(admin,'content_comment'),0);
  const publicReply=await c.comment(user,'post-austria-history',parent);await c.run(admin2,'select public.community_moderate_comment($1,$2,null)',[publicReply,'approved']);
  c.eq(await c.noticeCount(admin,'comment_reply'),1);c.eq(await c.noticeCount(admin,'content_comment'),0);
  const top=await c.comment(user);await c.run(admin2,'select public.community_moderate_comment($1,$2,null)',[top,'approved']);c.eq(await c.noticeCount(admin,'content_comment'),1);
  const userParent=await c.comment(other);await c.run(admin2,'select public.community_moderate_comment($1,$2,null)',[userParent,'approved']);
  const different=await c.comment(user,'post-austria-history',userParent);await c.run(admin2,'select public.community_moderate_comment($1,$2,null)',[different,'approved']);c.eq(await c.noticeCount(other,'comment_reply'),1);c.eq(await c.noticeCount(admin,'content_comment'),3);
  // Unknown legacy IDs and mutable usernames cannot manufacture an owner.
  await c.run(user,"insert into public.likes(user_id,target_type,target_id) values($1,'post','unknown')",[user]);c.eq(await c.noticeCount(admin,'content_like'),0);
  await c.run(user,"insert into public.likes(user_id,target_type,target_id) values($1,'post','post-austria-history')",[user]);c.eq(await c.noticeCount(admin,'content_like'),1);
  await c.run(user,"delete from public.likes where target_type='post' and target_id='post-austria-history'");c.eq(await c.noticeCount(admin,'content_like'),1);
  await c.run(admin,"insert into public.likes(user_id,target_type,target_id) values($1,'post','post-austria-history')",[admin]);c.eq(await c.noticeCount(admin,'content_like'),1);
  await db.query("update public.legacy_public_targets set author_id=$1 where target_type='moment'",[admin]);
  await c.run(user,"insert into public.likes(user_id,target_type,target_id) values($1,'moment','m20260930-153407-jq9o')",[user]);c.eq(await c.noticeCount(admin,'content_like'),2);
  await db.query("insert into public.legacy_public_targets(target_type,target_id,title,excerpt,target_path,published_at,author_id) values('album','trusted-album','Album','Text','gallery.html?album=trusted-album',now(),$1)",[admin]);
  await c.run(user,"insert into public.likes(user_id,target_type,target_id) values($1,'album','trusted-album')",[user]);c.eq(await c.noticeCount(admin,'content_like'),3);
  await c.denied(user,'update public.legacy_public_targets set author_id=$1',[user]);
  for(const kind of ['article','moment','album']) {
   const item=(await c.scalar(user,'select public.community_create_item($1,$2) as id',[kind,'n-'+randomUUID()])).id;
   const body=kind==='album'?{description:'album',photos:[{asset_id:await communityAsset(db,user)}]}:{text:'content'};
   const revision=(await c.scalar(user,'select public.community_save_revision($1,$2,$3) as id',[item,'Title',body])).id;
   await c.run(user,'select public.community_submit_revision($1)',[revision]);await c.run(admin,'select public.community_review_revision($1,$2,null)',[revision,'approved']);
   await c.run(other,"insert into public.likes(user_id,target_type,target_id) values($1,'content',$2)",[other,item]);
   const comment=await c.comment(other,'community-'+item);const before=await c.noticeCount(user,'content_comment');await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[comment,'approved']);c.eq(await c.noticeCount(user,'content_comment'),before+1);
   const privateComment=await c.comment(other,'community-'+item);
   const publicComments=await c.rows(null,'select * from public.community_public_comments($1,20,0)',[item],1);c.eq(publicComments[0].id,comment);c.eq(publicComments.some(r=>r.id===privateComment),false);
  }
  c.eq(await c.noticeCount(user,'content_like'),3);
  await c.run(other,"insert into public.likes(user_id,target_type,target_id) values($1,'comment',$2)",[other,plain]);c.eq(await c.noticeCount(user,'comment_like'),1);
  const t=await c.thread(other,user);await c.send(other,t,'Never copy this sensitive body');
  c.eq((await c.rows(user,"select body,title from public.notifications where type='direct_message'",[],1))[0],{body:'',title:'收到新私信'});
  for(const who of [admin,other])await c.rows(who,"select * from public.notifications where user_id=$1",[user],0);
  await c.run(admin,'select public.notification_mark_read(null)');c.eq(Number((await c.scalar(user,'select public.notification_unread_count() as n')).n)>0,true);
  await c.denied(user,"update public.notifications set body='forged'");await c.denied(user,"insert into public.notifications(user_id,type,title) values($1,'follow','forged')",[user]);
  // >50 items must be reachable through bounded pages, not a client cap.
  await db.query("insert into public.notifications(user_id,type,title) select $1,'follow','fixture' from generate_series(1,65)",[user]);
  const page=(await c.run(user,'select public.notifications_page(20,0) as n')).rows.map(r=>r.n);c.eq(page.length,20);
  c.eq((await c.run(user,'select public.notifications_page(20,60)')).rows.length>0,true);
  const id=page[0].id;await c.run(user,'select public.notification_mark_read($1)',[id]);c.eq((await c.rows(user,'select read from public.notifications where id=$1',[id],1))[0].read,true);
  await c.run(user,'select public.notification_mark_read(null)');c.eq(Number((await c.scalar(user,'select public.notification_unread_count() as n')).n),0);
  c.eq(Number((await c.scalar(user,'select public.dm_unread_count() as n')).n),1,'notification read does not pretend to read chat');
  c.eq((await db.query('select count(*)::int as n from public.notifications where user_id=actor_id')).rows[0].n,0);
  c.report('Notification events/privacy');
 }finally {await db.close();}
});
async function communityAsset(db,id) {
 const path=id+'/'+randomUUID()+'.png';await asActor(db,'authenticated',id,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2)",[path,{mimetype:'image/png',size:100}]);
 return (await asActor(db,'authenticated',id,'select public.community_register_asset($1,$2) as id',[path,'photo.png'])).rows[0].id;
}
async function conn(db,id){const c=await db.connect();await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return c;}
async function waitLock(db,pid){for(let i=0;i<100;i++){if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected real lock wait');}
test('Round 4 native concurrency: one stable thread, asset attachment versus Storage deletion, and orphan registration guard',options,async()=>{
 const db=await createNativeDatabase();try {
  await seedActors(db);const h=harness(db),one=await conn(db,user),two=await conn(db,other);
  const t=(await one.query('select public.dm_get_or_create_thread($1) as id',[other])).rows[0].id;
  const pid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
  const creating=two.query('select public.dm_get_or_create_thread($1) as id',[user]);await waitLock(db,pid);await one.query('commit');assert.equal((await creating).rows[0].id,t);await two.query('commit');
  const obj=await h.object(user),a=await h.asset(user,obj),sending=await conn(db,user),deleting=await conn(db,user);
  await sending.query('select public.dm_send_message($1,$2,$3)',[t,'Racing send',[a]]);
  const deletePid=(await deleting.query('select pg_backend_pid() as pid')).rows[0].pid;
  const removal=deleting.query('delete from storage.objects where id=$1',[obj.id]).then(()=>({ok:true}),error=>({error}));
  await waitLock(db,deletePid);await sending.query('commit');assert.match((await removal).error?.message||'',/foreign key|Sent images cannot be deleted/);await deleting.query('rollback');
  const orphan=await h.object(user);await h.run(user,'select public.dm_prepare_orphan_delete($1)',[orphan.id]);
  const registering=await conn(db,user),removing=await conn(db,user);await registering.query('select public.dm_register_asset($1,$2)',[orphan.name,'Race']);
  const removePid=(await removing.query('select pg_backend_pid() as pid')).rows[0].pid;
  const deletingOrphan=removing.query('delete from storage.objects where id=$1',[orphan.id]).then(()=>({ok:true}),error=>({error}));
  await waitLock(db,removePid);await registering.query('commit');assert.match((await deletingOrphan).error?.message||'',/Orphan became registered/);await removing.query('rollback');
 }finally {await db.close();}
});
