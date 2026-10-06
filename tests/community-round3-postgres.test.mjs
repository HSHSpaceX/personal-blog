import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {asActor,seedActors,actors} from './helpers/postgres.mjs';
const {user,other,admin,admin2}=actors;
const options={skip:!nativeConfigured&&'Set native PostgreSQL environment to execute Round 3 RLS and multi-connection races.'};
function checks(db){let assertions=0;
 const run=(id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
 const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
 const deny=async(id,sql,args=[],pattern=/permission denied|unavailable|Admin required|row-level security|registered|referenced/)=>{await assert.rejects(run(id,sql,args),pattern);assertions++;};
 const rows=async(id,sql,args=[],n=0)=>{const r=await run(id,sql,args);eq(r.rows.length,n);return r.rows;};
 const cards=async(id,name,args)=>(await run(id,'select '+name+' as card',args)).rows.map(r=>r.card);
 const comment=async(id,status='pending',parent=null)=>(await run(id,'insert into public.comments(user_id,post_slug,content,status,parent_id) values($1,$2,$3,$4,$5) returning id',[id,'post-austria-history','original',status,parent])).rows[0].id;
 const edit=async(id,c,text)=>(await run(id,'select public.community_edit_comment($1,$2) as id',[c,text])).rows[0].id;
 const review=(id,e,d='approved',reason=null)=>run(id,'select public.community_review_comment_edit($1,$2,$3)',[e,d,reason]);
 const object=async(id,mime='image/png')=>{const name=id+'/'+randomUUID()+'.png';const o=(await run(id,"insert into storage.objects(bucket_id,name,metadata) values('community-assets',$1,$2) returning id",[name,{mimetype:mime,size:99}])).rows[0].id;return {name,o};};
 const register=async(id,o)=>(await run(id,'select public.community_register_asset($1,$2) as id',[o.name,'image.png'])).rows[0].id;
 const item=async(id,type='article')=>(await run(id,'select public.community_create_item($1,$2) as id',[type,'test-'+randomUUID()])).rows[0].id;
 const save=async(id,i,body={text:'safe'})=>(await run(id,'select public.community_save_revision($1,$2,$3) as id',[i,'Public title',body])).rows[0].id;
 return {run,eq,deny,rows,cards,comment,edit,review,object,register,item,save,report:label=>console.log(label+': '+assertions+' assertions passed.')};
}
test('Round 3 public RPCs: minimal profile projections, bounded pages, current publication and safe recent likes',options,async()=>{
 const db=await createNativeDatabase();try{await seedActors(db);const c=checks(db);
 await c.run(other,'insert into public.follows(follower_id,target_id) values($1,$2)',[other,user]);
 await c.run(admin,'insert into public.follows(follower_id,target_id) values($1,$2)',[admin,user]);
 for(const actor of [null,user,admin]){
 const list=await c.rows(actor,'select * from public.profile_followers($1,1,0)',[user],1);c.eq(Object.keys(list[0]).sort(),['avatar_url','bio','display_name','id','username']);
 await c.rows(actor,'select * from public.profile_followers($1,1,1)',[user],1);await c.rows(actor,'select * from public.profile_followers($1,1,2)',[user],0);
 await c.rows(actor,'select * from public.profile_following($1,20,0)',[other],1);
 c.eq(Number((await c.run(actor,'select public.following_count($1) as n',[other])).rows[0].n),1);
 for(const args of [[51,0],[0,0],[20,-1],[20,100001],[null,0]])await c.deny(actor,'select * from public.profile_followers($1,$2,$3)',[user,...args],/Invalid page/);
 }
 await c.deny(null,'select * from public.follows');await c.deny(null,'select * from public.likes');await c.rows(other,'select * from public.follows where follower_id=$1',[admin],0);
 await c.deny(null,'select raw_user_meta_data from auth.users');
 const i=await c.item(user),r=await c.save(user,i,{text:'First public text'});
 await c.run(user,'select public.community_submit_revision($1)',[r]);
 await c.run(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'post','post-austria-history']);
 await c.run(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'moment','m20260930-153407-jq9o']);
 await c.deny(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'content',i]);
 await c.run(admin,'select public.community_review_revision($1,$2,null)',[r,'approved']);
 await c.run(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'content',i]);
 const pending=await c.save(user,i,{text:'Secret pending body'});await c.run(user,'select public.community_submit_revision($1)',[pending]);
 const approvedComment=await c.comment(admin,'approved');await c.run(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'comment',approvedComment]);
 const privateParent=await c.comment(user),reply=await c.comment(user,'pending',privateParent);await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[reply,'approved']);
 const hidden=await c.comment(user);await c.deny(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'comment',hidden]);
 // Retained old reaction rows must be revalidated, not trusted as proof of public visibility.
 await db.query('insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'comment',hidden]);
 const unpub=await c.item(other);await c.save(other,unpub,{text:'Private item'});await db.query('insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'content',unpub]);
 await db.query('insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'album','private-album']);
 await db.query("insert into public.legacy_public_targets values('album','public-album','Album','Public album','gallery.html?album=public-album',now())");
 await c.run(user,'insert into public.likes(user_id,target_type,target_id) values($1,$2,$3)',[user,'album','public-album']);
 for(const actor of [null,other,admin]){
 const likes=await c.cards(actor,'public.profile_recent_likes($1,20,0)',[user]);c.eq(likes.length,5);c.eq(likes.find(r=>r.target_id===i).text,'First public text');
 c.eq(likes.some(r=>[hidden,unpub,'private-album'].includes(r.target_id)),false);
 for(const card of likes)for(const key of ['user_id','author_id','role','email','raw_user_meta_data','rejection_reason','reviewer_id'])c.eq(Object.hasOwn(card,key),false);
 const content=await c.cards(actor,'public.profile_content($1,$2,20,0)',[user,'article']);c.eq(content.length,1);c.eq(content[0].revision_id,r);c.eq(content[0].text,'First public text');
 const comments=await c.cards(actor,'public.profile_content($1,$2,20,0)',[user,'comment']);c.eq(comments.length,1);c.eq(comments[0].parent_text,null);c.eq(comments[0].context.title.includes('奥匈'),true);
 for(const secret of [pending])await c.rows(actor===admin?other:actor,'select * from public.content_revisions where id=$1',[secret],0);
 }
 await c.run(admin,'select public.community_review_revision($1,$2,$3)',[pending,'rejected','Secret reason']);
 await c.rows(other,'select * from public.content_reviews where revision_id=$1',[pending],0);
 await db.query("update public.comments set status='rejected' where id=$1",[approvedComment]);await db.query("delete from public.legacy_public_targets where target_type='album'");
 c.eq((await c.cards(null,'public.profile_recent_likes($1,20,0)',[user])).length,3);
 await db.query('delete from public.content_items where id=$1',[i]);c.eq((await c.cards(null,'public.profile_recent_likes($1,20,0)',[user])).length,2);
 c.report('Public projections/privacy');
 }finally{await db.close();}
});

test('Round 3 comment edits: ownership, retained public body, reject/resubmit, pending replacement and admin self edit',options,async()=>{
 const db=await createNativeDatabase();try{await seedActors(db);const c=checks(db),comment=await c.comment(user);
 await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[comment,'approved']);
 const e=await c.edit(user,comment,'New private body');
 for(const actor of [null,other]){if(actor===null)await c.deny(actor,'select * from public.comment_edits where id=$1',[e]);else await c.rows(actor,'select * from public.comment_edits where id=$1',[e],0);}
 c.eq((await c.rows(null,'select content,status from public.comments where id=$1',[comment],1))[0],{content:'original',status:'approved'});
 await c.deny(other,'select public.community_edit_comment($1,$2)',[comment,'attack']);await c.deny(null,'select public.community_edit_comment($1,$2)',[comment,'attack']);
 for(const actor of [user,admin])for(const column of ['content','status','user_id','parent_id','post_slug'])await c.deny(actor,`update public.comments set ${column}=${column} where id=$1`,[comment]);
 await c.deny(user,'select public.community_review_comment_edit($1,$2,null)',[e,'approved']);await c.deny(user,'select public.community_moderate_comment($1,$2,null)',[comment,'approved']);
 await c.deny(user,'select public.community_edit_comment($1,$2)',[comment,'Another candidate'],/pending edit/);
 await c.deny(admin,'select public.community_review_comment_edit($1,$2,$3)',[e,'rejected',' '],/Invalid edit/);
 await c.review(admin2,e,'rejected','Needs more context');c.eq((await c.rows(null,'select content from public.comments where id=$1',[comment],1))[0].content,'original');
 c.eq((await c.rows(user,'select rejection_reason from public.comment_edits where id=$1',[e],1))[0].rejection_reason,'Needs more context');
 const resubmit=await c.edit(user,comment,'Final public text');await c.review(admin,resubmit);
 c.eq((await c.rows(null,'select content,status from public.comments where id=$1',[comment],1))[0],{content:'Final public text',status:'approved'});
 await c.deny(admin2,'select public.community_review_comment_edit($1,$2,null)',[resubmit,'approved'],/Only a pending/);
 const unpub=await c.comment(user),p1=await c.edit(user,unpub,'Updated pending'),p2=await c.edit(user,unpub,'Updated pending again');
 c.eq((await c.rows(user,'select status from public.comment_edits where id=$1',[p1],1))[0].status,'superseded');await c.rows(null,'select * from public.comments where id=$1',[unpub],0);
 await c.rows(user,"select * from public.comment_edits where comment_id=$1 and status='pending'",[unpub],1);
 await c.deny(admin,'select public.community_moderate_comment($1,$2,$3,$4)',[unpub,'approved',null,'Updated pending'],/Comment changed/);
 await c.review(admin,p2,'rejected','Not ready');c.eq((await c.rows(user,'select status from public.comments where id=$1',[unpub],1))[0].status,'rejected');
 const again=await c.edit(user,unpub,'New submission');await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[unpub,'approved']);
 c.eq((await c.rows(user,'select status from public.comment_edits where id=$1',[again],1))[0].status,'approved');
 for(const who of [admin,admin2]){const own=await c.comment(who,'approved'),ae=await c.edit(who,own,'Admin immediate');c.eq((await c.rows(null,'select content from public.comments where id=$1',[own],1))[0].content,'Admin immediate');
 c.eq((await c.rows(who,'select status,decision_source from public.comment_edits where id=$1',[ae],1))[0],{status:'approved',decision_source:'admin_auto'});}
 await c.rows(other,'select * from public.comment_edits',[],0);await c.deny(user,"insert into public.comment_edits default values");await c.deny(user,"delete from public.comment_edits");
 c.eq((await db.query('select count(*)::int as n from public.notifications where user_id=actor_id')).rows[0].n,0);
 const mine=await c.rows(user,'select * from public.community_my_comments(1,0)',[],1);c.eq(Object.keys(mine[0]).includes('user_id'),false);
 c.report('Comment edit state machine');
 }finally{await db.close();}
});

async function connection(db,id){const conn=await db.connect();await conn.query('begin');await conn.query('set local role authenticated');await conn.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return conn;}
async function waitLock(db,pid){for(let n=0;n<100;n++){const row=(await db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];if(row?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected actual PostgreSQL lock wait');}
test('Round 3 assets and concurrency: private pages/rename/reference deletion, orphan registration race, single edit decision',options,async()=>{
 const db=await createNativeDatabase();try{await seedActors(db);const c=checks(db),o=await c.object(user),a=await c.register(user,o),otherObj=await c.object(other),otherAsset=await c.register(other,otherObj);
 await c.run(user,'select public.community_rename_asset($1,$2)',[a,'<img onerror=alert(1)>.png']);
 const page=await c.rows(user,'select * from public.community_assets_page($1,$2,20,0)',['<img','image'],1);c.eq(page[0].reference_count,'0');c.eq(page[0].original_name,'<img onerror=alert(1)>.png');
 await c.rows(other,'select * from public.community_assets_page($1,$2,20,0)',['<img','image'],0);
 await c.deny(user,'select public.community_rename_asset($1,$2)',[otherAsset,'stolen']);await c.deny(user,'select public.community_prepare_asset_delete($1)',[otherAsset]);
 await c.deny(null,"select * from public.community_assets_page('', 'all',20,0)");
 await c.deny(user,"select * from public.community_assets_page('', 'unknown',20,0)",[],/Invalid asset filter/);
 const item=await c.item(user),revision=await c.save(user,item,{text:'Reference',asset_ids:[a]});
 await c.rows(user,'select * from public.community_asset_references($1,20,0)',[a],1);await c.deny(other,'select * from public.community_asset_references($1,20,0)',[a]);
 await c.deny(user,'select public.community_prepare_asset_delete($1)',[a]);await c.deny(user,'delete from storage.objects where id=$1',[o.o],/foreign key/);
 await c.run(user,'select public.community_submit_revision($1)',[revision]);await c.run(admin,'select public.community_review_revision($1,$2,$3)',[revision,'rejected','Keep rejected history']);
 await c.deny(user,'delete from storage.objects where id=$1',[o.o],/foreign key/);
 const orphan=await c.object(user);await c.rows(user,'select * from public.community_orphan_assets(20,0)',[],1);await c.rows(other,'select * from public.community_orphan_assets(20,0)',[],0);
 await c.deny(other,'select public.community_prepare_orphan_delete($1)',[orphan.o]);await c.deny(admin,'select public.community_prepare_orphan_delete($1)',[orphan.o]);
 await c.deny(user,'select public.community_prepare_orphan_delete($1)',[o.o],/registered/);
 c.eq((await c.run(user,'select public.community_prepare_orphan_delete($1) as path',[orphan.o])).rows[0].path,orphan.name);
 // Registration racing with Storage deletion after orphan preparation must win safely.
 const registering=await connection(db,user),removing=await connection(db,user);await registering.query('select public.community_register_asset($1,$2)',[orphan.name,'Racing registry']);
 const pid=(await removing.query('select pg_backend_pid() as pid')).rows[0].pid;
 const deletion=removing.query('delete from storage.objects where id=$1',[orphan.o]).then(()=>({ok:true}),error=>({error}));
 await waitLock(db,pid);await registering.query('commit');const result=await deletion;assert.match(result.error?.message||'',/Orphan became registered/);await removing.query('rollback');
 const registered=(await db.query('select id from public.user_assets where storage_object_id=$1',[orphan.o])).rows[0].id;
 await c.run(user,'select public.community_prepare_asset_delete($1)',[registered]);await c.rows(user,'delete from storage.objects where id=$1 returning id',[orphan.o],1);
 const clean=await c.object(user);await c.run(user,'select public.community_prepare_orphan_delete($1)',[clean.o]);await c.rows(user,'delete from storage.objects where id=$1 returning id',[clean.o],1);
 await c.deny(user,'select * from public.community_asset_delete_intents');await c.deny(user,"update public.user_assets set original_name='bypass'");
 c.eq((await db.query("select public from storage.buckets where id='community-assets'")).rows[0].public,false);
 const comment=await c.comment(user);await c.run(admin,'select public.community_moderate_comment($1,$2,null)',[comment,'approved']);const edit=await c.edit(user,comment,'Concurrent body');
 const one=await connection(db,admin),two=await connection(db,admin2),twoPid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
 await one.query("select public.community_review_comment_edit($1,'approved',null)",[edit]);
 const decision=two.query("select public.community_review_comment_edit($1,'rejected','Later decision')",[edit]).then(()=>({ok:true}),error=>({error}));
 await waitLock(db,twoPid);await one.query('commit');const second=await decision;assert.match(second.error?.message||'',/Only a pending/);await two.query('rollback');
 await c.rows(user,'select * from public.notifications where comment_edit_id=$1',[edit],1);
 c.report('Resources/orphans/actual concurrency');
 }finally{await db.close();}
});
