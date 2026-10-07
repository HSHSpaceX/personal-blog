import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const options={skip:!process.env.COMMUNITY_DOM_MODULE&&'Set COMMUNITY_DOM_MODULE for Round 3 DOM interactions.'};
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const user=randomUUID(),other=randomUUID(),asset=randomUUID(),comment=randomUUID(),edit=randomUUID();
const attack='<script>window.compromised=1</script><img onerror="window.compromised=2">';
const profile={id:other,username:'other_user',display_name:attack,bio:attack,avatar_url:'javascript:alert(1)'};
async function flush(){for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));}
async function dom(file,url){const imported=await import(process.env.COMMUNITY_DOM_MODULE),JSDOM=imported.JSDOM||imported.default.JSDOM;return new JSDOM(await read(file),{url:url||'https://blog.invalid/'+file,runScripts:'outside-only'});}
function auth(w,role='user'){let actor=role==='guest'?null:{id:user};const a={ready:async()=>{},configured:()=>true,user:()=>actor,isAdmin:()=>role==='admin',requireUser(){if(!actor)throw Error('Login required');return actor;},requireAdmin(){if(role!=='admin'||!actor)throw Error('Admin required');return actor;},signOut:async()=>{actor=null;}};w.BlogAuth=a;return {a,set(value){actor=value;}};}
function publicCard(index){return {kind:'article',target_type:'content',target_id:randomUUID(),title:'Card '+index,text:attack,published_at:'2026-10-06',username:'other_user',display_name:attack,avatar_url:'javascript:1',target_path:'profile.html?username=other_user&item='+randomUUID()};}
async function profileHarness(role='guest',own=false){const d=await dom('profile.html','https://blog.invalid/profile.html?username=other_user'),w=d.window,state=auth(w,role),calls=[],rows=Array.from({length:21},(_,i)=>publicCard(i));if(own)state.set({id:other});
 w.BlogTheme={setup(){}};w.BlogData={following:async()=>false,toggleFollow:async id=>{calls.push(['follow',id]);return true;},toggleLike:async()=>true,saveProfile:async()=>{},uploadAvatar:async()=>{}};
 w.PublicProfileData={profile:async()=>profile,counts:async()=>[2,3],legacy:()=>[],resolveLegacy:r=>r,
 content:async(id,type,offset)=>{calls.push(['content',type,offset]);return rows.slice(offset,offset+20);},followers:async(id,offset)=>{calls.push(['followers',offset]);return [profile];},following:async()=>[profile],likes:async()=>[{...publicCard(1),kind:'comment',title:'Reply',context:{title:'Context title'},parent_text:attack,liked_at:'2026-10-06',text:attack}]};
 w.eval(await read('js/public-cards.js'));w.eval(await read('js/profile.js'));await flush();const $=id=>w.document.getElementById(id);
 return {d,w,$,state,calls,rows,async click(id){$(id).click();await flush();}};
}
test('profile DOM: guests see public fields/cards, followers, bounded paging and inert text',options,async()=>{
 const h=await profileHarness();try{
 assert.equal(h.$('profileName').textContent,attack);assert.equal(h.$('profileBio').querySelector('script,img'),null);assert.equal(h.w.compromised,undefined);
 assert.equal(h.$('followBtn').hidden,true);assert.equal(h.$('profileMessage').hidden,false);assert.match(h.$('profileMessage').href,/login.html\?next=/);assert.equal(h.$('profileEditor').hidden,true);assert.equal(h.$('profileOwnLinks').hidden,true);
 assert.equal(h.$('profileAvatar').getAttribute('src'),'assets/avatar-default.jpg');assert.equal(h.$('profileCards').children.length,20);assert.equal(h.$('profileCards').querySelector('script,[onerror]'),null);
 assert.match(h.$('profileCards').querySelector('.public-author').href,/profile.html\?username=other_user/);
 await h.click('profileNext');assert.equal(h.$('profileCards').children.length,1);assert.equal(h.$('profileCards').querySelector('h3').textContent,'Card 20');await h.click('profilePrev');assert.equal(h.$('profileCards').querySelector('h3').textContent,'Card 0');
 await h.click('profileFollowers');assert.equal(h.$('profileCards').querySelector('.public-user-card').querySelector('button'),null);
 h.w.document.querySelector('[data-profile-tab="likes"]').click();await flush();assert.match(h.$('profileCards').textContent,/Context title/);assert.ok(h.$('profileCards').textContent.includes(attack));assert.equal(h.$('profileCards').querySelector('script,[onerror]'),null);
 }finally{h.d.window.close();}
});
test('profile DOM: user and admin share follow/message/own-edit behavior and logout clears editing fields',options,async()=>{
 for(const role of ['user','admin']){const h=await profileHarness(role);try{assert.equal(h.$('followBtn').hidden,false);assert.equal(h.$('profileMessage').hidden,false);assert.match(h.$('profileMessage').href,/messages.html\?user=/);assert.equal(h.w.document.querySelector('a[href="admin.html"]'),null);await h.click('followBtn');assert.ok(h.calls.some(c=>c[0]==='follow'));
 await h.click('profileFollowers');const b=h.$('profileCards').querySelector('button');assert.equal(b.textContent,'关注');b.click();await flush();assert.equal(b.textContent,'取消关注');}finally{h.d.window.close();}
 const own=await profileHarness(role,true);try{assert.equal(own.$('profileOwnLinks').hidden,false);assert.equal(own.$('followBtn').hidden,true);await own.click('profileEdit');assert.equal(own.$('profileEditor').hidden,false);own.state.set(null);own.w.document.dispatchEvent(new own.w.Event('blog-auth-change'));await flush();assert.equal(own.$('profileEditor').hidden,true);assert.equal(own.$('profileBioInput').value,'');}finally{own.d.window.close();}}
});
test('profile DOM: switching tabs discards an old pending response; legacy paging never repeats or skips cards',options,async()=>{
 const h=await profileHarness();try{let resolve;h.w.PublicProfileData.content=()=>new Promise(r=>{resolve=r;});h.w.document.querySelector('[data-profile-tab="album"]').click();await flush();await h.click('profileFollowers');resolve([publicCard(99)]);await flush();assert.equal(h.$('profileCards').querySelector('.public-content-card'),null);
 h.w.PublicProfileData.profile=async()=>({...profile,username:'hshspacex'});h.w.PublicProfileData.content=async()=>[];h.w.PublicProfileData.legacy=()=>Array.from({length:21},(_,i)=>({...publicCard(i),legacy:true}));h.w.document.dispatchEvent(new h.w.Event('blog-auth-change'));await flush();await h.click('profileNext');assert.equal(h.$('profileCards').querySelector('h3').textContent,'Card 20');await h.click('profilePrev');assert.equal(h.$('profileCards').querySelector('h3').textContent,'Card 0');}finally{h.d.window.close();}
});
test('comment editing DOM: rejected reason/pre-fill, pending submit and admin queue decisions with required reason',options,async()=>{
 const d=await dom('account.html'),w=d.window,state=auth(w),calls=[],$=id=>w.document.getElementById(id);
 const c={id:comment,post_slug:'post-austria-history',content:'Old public text',status:'approved',created_at:'2026-10-06',latest_edit:{id:edit,status:'rejected',proposed_content:attack,rejection_reason:attack}};
 w.CommentEditData={mine:async()=>[c],queue:async()=>[],save:async(id,text)=>{calls.push(['save',id,text]);c.latest_edit={status:'pending',proposed_content:text};},ownComment:async()=>c};
 try{w.eval(await read('js/account-comments.js'));await w.AccountComments.refresh();assert.ok($('accountCommentsList').textContent.includes(attack));assert.equal($('accountCommentsList').querySelector('script,img'),null);$('accountCommentsList').querySelector('button').click();await flush();assert.equal($('accountCommentText').value,attack);$('accountCommentText').value='Re-edited';$('accountCommentSubmit').click();await flush();assert.deepEqual(calls[0],['save',comment,'Re-edited']);assert.equal($('accountCommentsList').querySelector('button'),null);
 state.set(null);w.AccountComments.clear();assert.equal($('accountCommentText').value,'');assert.equal($('accountCommentsList').textContent,'');
 }finally{d.window.close();}
 const adminDOM=await dom('account.html'),aw=adminDOM.window;auth(aw,'admin');const actions=[],a=id=>aw.document.getElementById(id);aw.CommentEditData={mine:async()=>[],queue:async()=>[{id:edit,comment_id:comment,author_id:other,created_at:'2026-10-06',previous_content:'Old',proposed_content:attack,status:'pending'}],review:async(...args)=>{actions.push(args);}};
 try{aw.eval(await read('js/account-comments.js'));await aw.AccountComments.refresh();assert.equal(a('accountCommentQueue').querySelector('script,img'),null);const reject=Array.from(a('accountCommentQueue').querySelectorAll('button')).find(b=>b.textContent==='拒绝评论编辑');reject.click();await flush();assert.equal(actions.length,0);assert.match(a('accountCommentsStatus').textContent,/填写原因/);a('accountCommentQueue').querySelector('textarea').value=attack;reject.click();await flush();assert.deepEqual(actions[0],[edit,'rejected',attack]);}finally{adminDOM.window.close();}
});
test('resource center DOM: search/filter/page, signed thumbnails, rename, reference lock, selection, orphan cleanup and logout',options,async()=>{
 const d=await dom('account.html'),w=d.window,state=auth(w),calls=[],timers=[],$=id=>w.document.getElementById(id);
 const rows=Array.from({length:21},(_,i)=>({id:i===0?asset:randomUUID(),original_name:i===0?attack:'file '+i,mime_type:'image/png',size_bytes:99,created_at:'2026-10-06',reference_count:i===0?3:0}));
 w.setTimeout=fn=>{timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
 w.CommunityData={assetsPage:async(search,kind,offset)=>{calls.push(['page',search,kind,offset]);return rows.slice(offset,offset+20);},orphans:async()=>[{object_id:randomUUID(),object_path:user+'/orphan.png'}],signedAsset:async()=>({url:'https://test.supabase.co/private?token=short',expiresAt:Date.now()+60000}),renameAsset:async(...args)=>{calls.push(['rename',...args]);},deleteAsset:async(...args)=>{calls.push(['delete',...args]);},deleteOrphan:async(...args)=>{calls.push(['orphan',...args]);},assetReferences:async()=>[{title:attack,status:'rejected',revision_no:1,revision_id:randomUUID(),is_current_public:false}]};
 let selected;w.addEventListener('community-asset-selected',e=>{selected=e.detail.id;});
 try{w.eval(await read('js/asset-center.js'));await w.AssetCenter.refresh();await flush();assert.equal($('assetCenterList').children.length,20);assert.equal($('assetCenterList').querySelector('[onerror],script'),null);const first=$('assetCenterList').firstChild;assert.equal(Array.from(first.querySelectorAll('button')).find(b=>b.textContent.includes('禁止删除')).disabled,true);
 first.querySelector('input').value='safe name';Array.from(first.querySelectorAll('button')).find(b=>b.textContent==='重命名').click();await flush();assert.ok(calls.some(c=>c[0]==='rename'&&c[2]==='safe name'));
 const current=$('assetCenterList').firstChild;Array.from(current.querySelectorAll('button')).find(b=>b.textContent==='选择用于投稿').click();await flush();assert.equal(selected,asset);Array.from(current.querySelectorAll('button')).find(b=>b.textContent==='查看引用').click();await flush();assert.match($('assetReferenceList').textContent,/rejected/);assert.equal($('assetReferenceList').querySelector('script,img'),null);
 $('assetNext').click();await flush();assert.equal($('assetCenterList').children.length,1);assert.deepEqual(calls.filter(c=>c[0]==='page').at(-1),['page','','all',20]);
 $('assetSearch').value='name';$('assetKind').value='document';$('assetRefresh').click();await flush();assert.deepEqual(calls.filter(c=>c[0]==='page').at(-1),['page','name','document',0]);
 $('assetOrphanList').querySelector('button').click();await flush();assert.ok(calls.some(c=>c[0]==='orphan'));timers.forEach(fn=>fn());assert.equal($('assetCenterList').querySelector('img'),null);
 state.set(null);w.AssetCenter.clear();assert.equal($('assetCenterList').textContent,'');assert.equal($('assetOrphanList').textContent,'');assert.equal($('assetSearch').value,'');
 }finally{d.window.close();}
});
test('data API: public page RPCs/select whitelist; resource removal uses Storage only and cancels on wrong path/identity or referenced error',options,async()=>{
 const d=await dom('profile.html'),w=d.window,state=auth(w),calls=[];let path=user+'/object.png',fail=null,changeActor=false;
 const query={select(fields){calls.push(['select',fields]);return this;},eq(){return this;},async maybeSingle(){return {data:profile};}};
 const db={from(table){calls.push(['from',table]);return query;},async rpc(name,args){calls.push(['rpc',name,args]);if(changeActor)state.set({id:other});return {data:path,error:fail};},storage:{from(){return {async remove(paths){calls.push(['storage-remove',...paths]);return {data:[]};}};}}};state.a.client=()=>db;
 try{w.eval(await read('js/community-schema.js'));w.eval(await read('js/public-profile-data.js'));w.eval(await read('js/community-data.js'));await w.PublicProfileData.profile({username:'other_user'});assert.deepEqual(calls[1],['select','id,username,display_name,avatar_url,bio']);await w.PublicProfileData.followers(other,20);assert.equal(calls.at(-1)[1],'profile_followers');assert.equal(calls.at(-1)[2].p_limit,20);assert.ok(!calls.some(c=>c[0]==='from'&&['follows','likes','auth.users','user_roles'].includes(c[1])));
 await w.CommunityData.deleteAsset(asset);assert.equal(calls.at(-1)[0],'storage-remove');path=other+'/stolen.png';await assert.rejects(w.CommunityData.deleteOrphan(randomUUID()),/无效资源路径/);const removes=calls.filter(c=>c[0]==='storage-remove').length;
 path=user+'/object.png';fail=Error('referenced');await assert.rejects(w.CommunityData.deleteAsset(asset),/referenced/);fail=null;changeActor=true;await assert.rejects(w.CommunityData.deleteOrphan(randomUUID()),/账号已变化/);assert.equal(calls.filter(c=>c[0]==='storage-remove').length,removes);
 }finally{d.window.close();}
});
test('comment edit deep UUID failure never renders private text; late asset response after logout stays cleared',options,async()=>{
 const d=await dom('account.html','https://blog.invalid/account.html?edit='+edit),w=d.window,state=auth(w);w.CommentEditData={mine:async()=>[],getEdit:async()=>{throw Error('无权访问');}};
 try{w.eval(await read('js/account-comments.js'));await w.AccountComments.refresh();assert.match(w.document.getElementById('accountCommentsStatus').textContent,/无权访问/);assert.equal(w.document.getElementById('accountCommentText').value,'');
 let resolve;w.CommunityData={assetsPage:()=>new Promise(r=>{resolve=r;})};w.eval(await read('js/asset-center.js'));const pending=w.AssetCenter.refresh();await flush();state.set(null);w.AssetCenter.clear();resolve([{id:asset,original_name:attack}]);await pending;assert.equal(w.document.getElementById('assetCenterList').textContent,'');
 }finally{d.window.close();}
});
