import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const options={skip:!process.env.COMMUNITY_DOM_MODULE&&'Set COMMUNITY_DOM_MODULE for Round 4 DOM tests.'};
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const user=randomUUID(),other=randomUUID(),third=randomUUID(),thread=randomUUID(),secondThread=randomUUID(),asset=randomUUID();
const attack='<script>window.compromised=1</script><img onerror="window.compromised=2">';
const profile={id:other,username:'other_user',display_name:attack,avatar_url:'javascript:alert(1)'};
const uuid=id=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||'');
async function flush(){for(let n=0;n<20;n++)await new Promise(r=>setImmediate(r));}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function dom(file,url){const imported=await import(process.env.COMMUNITY_DOM_MODULE),JSDOM=imported.JSDOM||imported.default.JSDOM;return new JSDOM(await read(file),{url:url||'https://blog.invalid/'+file,runScripts:'outside-only'});}
function auth(w,role='user'){
 let actor={id:user},currentRole=role;
 w.BlogAuth={ready:async()=>{},configured:()=>true,user:()=>actor,isAdmin:()=>currentRole==='admin',requireUser(){if(!actor)throw Error('Login required');return actor;}};
 w.BlogTheme={setup(){}};
 return {set(a,r='user'){actor=a;currentRole=r;},change(a,r='user'){actor=a;currentRole=r;w.document.dispatchEvent(new w.Event('blog-auth-change'));}};
}
function message(no,images=false){return {id:randomUUID(),message_no:no,sender_id:no%2?user:other,body:attack+' '+no,created_at:'2026-10-07T12:00:00Z',assets:images?[{id:asset,original_name:attack}]:[]};}
async function harness(url='messages.html',role='user'){
 const d=await dom('messages.html','https://blog.invalid/'+url),w=d.window,state=auth(w,role),calls=[],timers=[],$=id=>w.document.getElementById(id);
 w.setInterval=()=>1;w.setTimeout=fn=>{timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
 const notices=Array.from({length:65},(_,i)=>({id:randomUUID(),type:i===0?'comment_rejected':i===1?'direct_message':'follow',title:attack+' '+i,body:i===0?attack:'',comment_id:randomUUID(),dm_thread_id:thread,actorUsername:'other_user',actorName:attack,actorAvatar:'javascript:1',target_type:'profile',target_id:other,read:false,created_at:'2026-10-07'}));
 const messages=Array.from({length:21},(_,i)=>message(21-i,i===0));
 w.BlogData={listNotifications:async offset=>{calls.push(['notifications',offset]);return notices.slice(offset,offset+20);},notificationCount:async()=>notices.filter(n=>!n.read).length,
 markNotificationsRead:async id=>{calls.push(['read',id]);notices.forEach(n=>{if(!id||n.id===id)n.read=true;});}};
 w.MessageData={uuid,getThread:async target=>{calls.push(['get-thread',target]);return thread;},
 threads:async offset=>{calls.push(['threads',offset]);return [{id:thread,...profile,unread_count:2,last_message_at:'2026-10-07'},{id:secondThread,...profile,unread_count:0,last_message_at:'2026-10-07'}];},
 threadInfo:async id=>({id,peer:profile}),messages:async(id,before)=>{calls.push(['messages',id,before]);return messages.filter(m=>!before||m.message_no<before).slice(0,20);},
 markRead:async(...args)=>{calls.push(['thread-read',...args]);},unread:async()=>2,
 signedAsset:async()=>({url:'https://storage.invalid/private?token=short',expiresAt:Date.now()+60000}),
 upload:async file=>{calls.push(['upload',file.name]);return {id:asset,original_name:file.name};},
 send:async(...args)=>{calls.push(['send',...args]);messages.unshift({...message(messages[0].message_no+1),body:args[1],assets:args[2].map(id=>({id,original_name:'photo.png'}))});},
 unsent:async offset=>{calls.push(['unsent',offset]);return [{id:asset,original_name:attack,size_bytes:99}];},orphans:async()=>[{object_id:asset,object_path:user+'/orphan.png'}],
 removeAsset:async id=>calls.push(['remove-asset',id]),removeOrphan:async id=>calls.push(['remove-orphan',id])};
 w.eval(await read('js/public-cards.js'));w.eval(await read('js/messages.js'));await flush();
 return {d,w,state,calls,timers,$,notices,messages,async click(id){$(id).click();await flush();}};
}
test('Round 4 notification DOM: user/admin pagination beyond 50, individual/all reads, reasons, whitelist actions and inert text',options,async()=>{
 for(const role of ['user','admin']){const h=await harness('messages.html',role);try{
  assert.equal(h.$('messagesList').children.length,20);assert.equal(h.$('notificationUnread').textContent,'65');assert.equal(h.$('messagesList').querySelector('script,[onerror]'),null);assert.equal(h.w.compromised,undefined);
  assert.match(h.$('messagesList').firstChild.querySelector('.btn').href,/account.html\?comment=.*#my-comments/);
  assert.match(h.$('messagesList').children[1].querySelector('.btn').href,/messages.html\?thread=/);
  assert.equal(h.w.MessageCenter.action({type:'follow',target_id:'javascript:alert(1)',action_url:'https://evil.invalid'}),null);
  assert.equal(h.w.MessageCenter.action({type:'content_like',target_type:'post',target_id:'../../private'}),null);
  h.$('messagesList').firstChild.querySelector('button').click();await flush();assert.equal(h.notices[0].read,true);assert.equal(h.$('notificationUnread').textContent,'64');
  for(let n=0;n<3;n++)await h.click('notificationNext');assert.equal(h.$('messagesList').children.length,5);assert.equal(h.calls.filter(c=>c[0]==='notifications').at(-1)[1],60);
  await h.click('notificationReadAll');assert.equal(h.$('notificationUnread').textContent,'0');assert.equal(h.$('dmUnread').textContent,'2');assert.equal(h.notices.every(n=>n.read),true);
 }finally{h.d.window.close();}}
});
test('Round 4 DM DOM: user entry, safe history/images, cursor pagination, text/image send and unsent cleanup',options,async()=>{
 const h=await harness('messages.html?user='+other);try{
  assert.deepEqual(h.calls.find(c=>c[0]==='get-thread'),['get-thread',other]);assert.equal(h.$('dmPanel').hidden,false);assert.equal(h.$('dmHistory').children.length,20);
  assert.equal(h.$('dmHistory').querySelector('script,[onerror]'),null);assert.equal(h.$('dmHistory').querySelectorAll('.dm-mine').length,10);assert.equal(h.$('dmHistory').querySelectorAll('.dm-theirs').length,10);
  assert.match(h.$('dmHistory').querySelector('img').src,/token=short/);assert.deepEqual(h.calls.find(c=>c[0]==='thread-read'),['thread-read',thread,21]);
  await h.click('dmOlder');assert.equal(h.$('dmHistory').children.length,21);assert.equal(h.$('dmOlder').disabled,true);assert.equal(h.calls.filter(c=>c[0]==='messages').at(-1)[2],2);
  const file=new h.w.File(['PNG'],'picture.png',{type:'image/png'});Object.defineProperty(h.$('dmImages'),'files',{configurable:true,value:[file]});h.$('dmImages').dispatchEvent(new h.w.Event('change'));await flush();
  assert.match(h.$('dmAttachments').textContent,/picture.png/);h.$('dmBody').value=attack;h.$('dmComposer').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
  const send=h.calls.find(c=>c[0]==='send');assert.deepEqual(send.slice(0,3),['send',thread,attack]);assert.deepEqual(Array.from(send[3]),[asset]);assert.equal(h.$('dmBody').value,'');assert.equal(h.$('dmAttachments').textContent,'');
  await h.click('dmAssetsRefresh');assert.equal(h.$('dmUnsent').querySelector('script,img'),null);h.$('dmUnsent').querySelector('button').click();await flush();assert.ok(h.$('dmAttachments').textContent.includes(attack));
  h.$('dmComposer').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();assert.equal(h.calls.filter(c=>c[0]==='send').at(-1)[2],'');
  await h.click('dmAssetsRefresh');Array.from(h.$('dmUnsent').querySelectorAll('button')).find(b=>b.textContent.includes('删除')).click();await flush();assert.ok(h.calls.some(c=>c[0]==='remove-asset'));
  h.$('dmOrphans').querySelector('button').click();await flush();assert.ok(h.calls.some(c=>c[0]==='remove-orphan'));
  h.timers.forEach(fn=>fn());assert.equal(h.$('dmHistory').querySelector('img'),null);
 }finally{h.d.window.close();}
});
test('Round 4 stale responses: thread switch, account switch, downgrade and logout discard messages, notifications, uploads and signed URLs',options,async()=>{
 const h=await harness('messages.html?thread='+thread,'admin');try{
  const delayed=deferred();h.w.MessageData.messages=()=>delayed.promise;h.$('dmChatRefresh').click();await flush();
  h.w.MessageData.messages=async()=>[{...message(1),body:'New thread body'}];h.$('dmThreads').children[1].querySelector('button').click();await flush();
  delayed.resolve([{...message(90),body:'OLD THREAD SECRET'}]);await flush();assert.ok(!h.$('dmHistory').textContent.includes('OLD THREAD SECRET'));assert.match(h.$('dmHistory').textContent,/New thread body/);
  const signed=deferred();h.w.MessageData.signedAsset=()=>signed.promise;h.w.MessageData.messages=async()=>[message(2,true)];await h.click('dmChatRefresh');
  const upload=deferred();h.w.MessageData.upload=()=>upload.promise;Object.defineProperty(h.$('dmImages'),'files',{value:[new h.w.File(['data'],'old.png',{type:'image/png'})],configurable:true});h.$('dmImages').dispatchEvent(new h.w.Event('change'));await flush();
  h.w.MessageData.threadInfo=async()=>{throw Error('Thread unavailable');};h.state.change({id:third});await flush();signed.resolve({url:'https://storage.invalid/OLD-PRIVATE',expiresAt:Date.now()+60000});upload.resolve({id:asset,original_name:'OLD UPLOAD'});await flush();
  assert.equal(h.$('dmHistory').querySelector('img'),null);assert.ok(!h.$('dmAttachments').textContent.includes('OLD UPLOAD'));assert.equal(h.$('dmBody').value,'');
  h.w.MessageData.threadInfo=async()=>({id:thread,peer:profile});h.w.MessageData.messages=async()=>[];h.state.change({id:user},'user');await flush();assert.equal(h.$('dmHistory').textContent.includes('OLD THREAD SECRET'),false);
  const inbox=deferred();h.w.BlogData.listNotifications=()=>inbox.promise;h.$('notificationTab').click();await flush();h.w.MessageCenter.clear();h.state.set(null);inbox.resolve([{title:'OLD INBOX SECRET',created_at:'2026-10-07'}]);await flush();
  assert.equal(h.$('messagesList').textContent,'');assert.equal(h.$('dmHistory').textContent,'');assert.equal(h.$('dmUnsent').textContent,'');assert.equal(h.$('notificationUnread').textContent,'0');assert.equal(h.$('messagePanels').hidden,true);
 }finally{h.d.window.close();}
});
test('Round 4 data API: captured sender, private upload/sign, no overwrite/public URL and safe Storage deletion across account changes',options,async()=>{
 const d=await dom('messages.html'),w=d.window,state=auth(w),calls=[];let path=user+'/'+randomUUID()+'.png',uploadWait=null,signedUrl='https://storage.invalid/private?token=60';
 w.BlogConfig={SUPABASE_URL:'https://storage.invalid'};
 const query={select(fields){calls.push(['select',fields]);return this;},eq(){return this;},async maybeSingle(){return {data:{id:asset,object_path:path,original_name:'photo'}};}};
 const storage={async upload(...args){calls.push(['upload',...args]);if(uploadWait)await uploadWait.promise;return {data:{}};},async createSignedUrl(...args){calls.push(['signed',...args]);return {data:{signedUrl}};},async remove(paths){calls.push(['remove',...paths]);return {data:[]};}};
 w.BlogAuth.client=()=>({from(table){calls.push(['from',table]);return query;},rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:name.includes('prepare')?path:asset};},storage:{from(bucket){calls.push(['bucket',bucket]);return storage;}}});
 try{w.eval(await read('js/message-data.js'));await w.MessageData.send(thread,'message',[]);assert.equal(calls.find(c=>c[0]==='rpc')[2].p_expected_sender_id,user);
  const file=new w.File(['PNG'],'safe.png',{type:'image/png'});await w.MessageData.upload(file);assert.equal(calls.find(c=>c[0]==='upload')[3].upsert,false);assert.ok(calls.filter(c=>c[0]==='bucket').every(c=>c[1]==='dm-media'));
  const register=calls.find(c=>c[0]==='rpc'&&c[1]==='dm_register_asset');assert.deepEqual(Object.keys(register[2]).sort(),['p_object_path','p_original_name']);
  await w.MessageData.signedAsset(asset);assert.equal(calls.find(c=>c[0]==='signed')[2],60);
  for(const invalid of ['javascript:alert(1)','http://storage.invalid/private','https://evil.invalid/private']){signedUrl=invalid;await assert.rejects(w.MessageData.signedAsset(asset),/地址/);}
  await w.MessageData.removeAsset(asset);assert.equal(calls.at(-1)[0],'remove');path=other+'/'+randomUUID()+'.png';await assert.rejects(w.MessageData.removeOrphan(asset),/不安全/);
  await assert.rejects(w.MessageData.upload(new w.File(['SVG'],'x.svg',{type:'image/svg+xml'})),/JPG/);
  path=user+'/'+randomUUID()+'.png';uploadWait=deferred();const pending=w.MessageData.upload(file);await flush();const count=calls.filter(c=>c[0]==='rpc'&&c[1]==='dm_register_asset').length;
  state.change({id:other});uploadWait.resolve();await assert.rejects(pending,/账号已变化/);assert.equal(calls.filter(c=>c[0]==='rpc'&&c[1]==='dm_register_asset').length,count);
 }finally{d.window.close();}
});
test('Round 4 account unread DOM: separate notification/DM counts and late results stay cleared after logout',options,async()=>{
 const d=await dom('account.html'),w=d.window,state=auth(w),$=id=>w.document.getElementById(id);
 w.BlogData={getProfile:async()=>profile,notificationCount:async()=>5,followerCount:async()=>2,dmUnreadCount:async()=>3};
 try{w.eval(await read('js/account.js'));await flush();assert.equal($('accountNotificationCount').textContent,'5 条未读通知');assert.equal($('accountDMCount').textContent,'3 条未读私信');assert.match(w.document.querySelector('#direct-messages a').href,/messages.html\?tab=dm/);
  const pending=deferred();w.BlogData.dmUnreadCount=()=>pending.promise;state.change({id:user});await flush();state.change(null);pending.resolve(99);await flush();assert.equal($('accountDMCount').textContent,'');assert.equal($('accountNotificationCount').textContent,'');assert.equal($('accountSections').hidden,true);
 }finally{d.window.close();}
});
test('Round 4 Community comment DOM: approved page, safe text, reply submission stays pending and private responses clear on auth change',options,async()=>{
 const d=await dom('profile.html'),w=d.window,state=auth(w),calls=[];let delayed=null;
 w.BlogAuth.client=()=>({rpc:async(name,args)=>{calls.push(['rpc',name,args]);return delayed?delayed.promise:{data:[{...profile,id:asset,author_id:other,parent_id:null,content:attack,created_at:'2026-10-07'}]};}});
 w.BlogData={addComment:async(...args)=>calls.push(['comment',...args])};
 try{w.eval(await read('js/public-cards.js'));w.eval(await read('js/profile-comments.js'));await w.ProfileComments.show(thread);const slot=w.document.getElementById('profileDiscussion');
  assert.equal(slot.querySelector('script,[onerror]'),null);assert.ok(slot.textContent.includes(attack));slot.querySelector('article button').click();slot.querySelector('textarea').value=attack;slot.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.deepEqual(calls.find(c=>c[0]==='comment'),['comment','community-'+thread,attack,asset]);assert.match(slot.textContent,/审核通过后公开/);
  delayed=deferred();const pending=w.ProfileComments.show(secondThread);await flush();state.change(null);delayed.resolve({data:[{content:'OLD PRIVATE RESULT',created_at:'2026-10-07'}]});await pending;assert.equal(slot.textContent,'');
 }finally{d.window.close();}
});
test('Round 4 menu unread badge: late counts cannot replace a new account or reappear after logout',options,async()=>{
 const d=await dom('index.html'),w=d.window,state=auth(w),pending=deferred();
 w.BlogData={messageUnreadCount:()=>pending.promise};
 try{const source=await read('js/site.js'),start=source.indexOf('  function updateNotificationBadge('),end=source.indexOf('  function setupRail()',start);
  w.eval('(function(){'+source.slice(start,end)+'window.refreshBadge=refreshNotificationBadge;})();');w.refreshBadge();await flush();
  state.set({id:other});w.BlogData.messageUnreadCount=async()=>7;w.refreshBadge();await flush();pending.resolve(99);await flush();
  const badges=w.document.querySelectorAll('.notification-badge');assert.ok(badges.length>0);badges.forEach(b=>{assert.equal(b.textContent,'7');assert.equal(b.hidden,false);});
  state.set(null);w.refreshBadge();await flush();badges.forEach(b=>assert.equal(b.hidden,true));
 }finally{d.window.close();}
});
