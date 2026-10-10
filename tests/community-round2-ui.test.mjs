import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import schema from '../js/community-schema.js';
const domModule=process.env.COMMUNITY_DOM_MODULE;
const options={skip:!domModule&&'Set COMMUNITY_DOM_MODULE to run real DOM submission and review flows.'};
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const user=randomUUID(), other=randomUUID(), admin=randomUUID(), image=randomUUID();
const hostile='<script>window.compromised=1</script><img src=x onerror="window.compromised=2"> javascript:alert(1)';
async function settle(){for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));}
async function dom(page='account.html',url='https://blog.invalid/account.html'){
 const imported=await import(domModule), JSDOM=imported.JSDOM||imported.default.JSDOM;
 return new JSDOM(await read(page),{url,runScripts:'outside-only'});
}
async function harness(role='user',revision){
 const d=await dom('account.html','https://blog.invalid/account.html'+(revision?'?revision='+revision.id:'')),w=d.window;
 let actor={id:role==='admin'?admin:user};const items=new Map(),revs=new Map(),calls=[],files=[{id:image,original_name:'<img onerror=alert(1)>.png',mime_type:'image/png',size_bytes:10}];
 if(revision){items.set(revision.content_items.id,revision.content_items);revs.set(revision.id,revision);}
 const auth={user:()=>actor,isAdmin:()=>!!actor&&role==='admin',requireUser(){if(!actor)throw Error('Login required');return actor;},requireAdmin(){if(!this.isAdmin())throw Error('Admin required');return actor;}};
 function save(item,title,body){const id=randomUUID();revs.set(id,{id,title,body:structuredClone(body),item_id:item.id,status:'draft',content_items:item});calls.push(['save',id]);return id;}
 const data={
 async listItems(){return [...items.values()].filter(i=>i.author_id===actor.id).map(i=>({...i,content_revisions:[...revs.values()].filter(r=>r.item_id===i.id).slice(-1)}));},
 async listAssets(){return files;},async getRevision(id){calls.push(['get',id]);const row=revs.get(id);if(!row||(!auth.isAdmin()&&row.content_items.author_id!==actor.id))throw Error('此版本不存在或你没有访问权限。');return structuredClone(row);},
 async create(type,slug,title,body){const item={id:randomUUID(),author_id:actor.id,content_type:type,slug,published_revision_id:null};items.set(item.id,item);return save(item,title,body);},
 async save(item,title,body){return save(items.get(item.id),title,body);},async submit(id){calls.push(['submit',id]);revs.get(id).status='pending';},
 async listReviews(){return [...revs.values()].filter(r=>r.status==='pending');},
 async review(id,decision,reason){calls.push(['review',id,decision,reason]);const r=revs.get(id);r.status=decision;r.rejection_reason=reason;if(decision==='approved')items.get(r.item_id).published_revision_id=id;},
 async policyUser(name){calls.push(['policyUser',name]);return {id:other,username:'other_user'};},
 async policyStatus(){return ['article','moment','album'].map(content_type=>({content_type,manual_approvals_required:null,approved_new_count:0}));},
 async setThreshold(id,type,n){calls.push(['threshold',id,type,n]);},
 async upload(file){calls.push(['upload',file.name]);files.push({id:randomUUID(),original_name:file.name,mime_type:file.type,size_bytes:file.size});},
 async signedAsset(id){calls.push(['signed',id]);return {asset:files.find(f=>f.id===id),url:'https://test.supabase.co/storage/v1/object/sign/community-assets/private?token=short',expiresAt:Date.now()+60000};}
 };
 w.BlogAuth=auth;w.CommunityData=data;const timers=[];w.setTimeout=fn=>{timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
 w.eval(await read('js/community-schema.js'));w.eval(await read('js/community-ui.js'));
 const $=id=>w.document.getElementById(id);
 async function click(id){$(id).click();await settle();}
 return {d,w,$,click,calls,revs,items,timers,files,logout(){actor=null;w.CommunityUI.clear();},data};
}
function row(type,status='rejected',author=user,body={text:hostile}){const item={id:randomUUID(),author_id:author,content_type:type,published_revision_id:null};return {id:randomUUID(),item_id:item.id,title:'<svg onload=alert(1)> title',body,status,rejection_reason:status==='rejected'?hostile:null,content_items:item};}

test('schema refuses active fields, arbitrary URLs, oversized and duplicate references for each format',()=>{
 for(const body of [{text:'x',html:hostile},{text:'x',url:'javascript:1'},{text:'x',onerror:'evil'},{text:'x',tags:Array(11).fill('tag')},{text:'x'.repeat(2001)}])assert.throws(()=>schema.validate('moment','Title',body));
 assert.throws(()=>schema.validate('article','Title',{text:'x',asset_ids:[image,image.toUpperCase()]}));
 assert.throws(()=>schema.validate('album','Title',{photos:[{asset_id:image,url:'javascript:1'}]}));
 assert.throws(()=>schema.validate('album','Title',{photos:[]}));
 assert.deepEqual(schema.validate('article','Title',{text:hostile}),[]);
});

test('real DOM: article/moment/album authoring, immutable drafts, safe previews and submission',options,async()=>{
 const h=await harness();try{
 await h.w.CommunityUI.refresh();
 for(const type of ['article','moment','album']){
 h.w.document.querySelector('[data-new-content="'+type+'"]').click();await settle();
 h.$('communityTitle').value=type+' title';h.$('communityText').value=hostile;
 if(type==='album'){const choice=h.$('communityAssetChoices').querySelector('input[type=checkbox]');choice.checked=true;h.$('communityAssetChoices').querySelector('[data-asset-caption]').value=hostile;}
 await h.click('communitySave');const saved=[...h.revs.values()].at(-1);assert.equal(saved.status,'draft');assert.equal(saved.content_items.content_type,type);assert.match(h.w.location.search,/revision=/);
 await h.click('communityTextPreview');assert.ok(h.$('communityPreviewBody').textContent.includes(hostile));assert.equal(h.$('communityPreviewBody').querySelector('script,img,svg,a'),null);assert.equal(h.w.compromised,undefined);
 if(type==='album'){assert.equal(h.$('communityPreviewAssets').querySelector('img').alt,hostile);assert.equal(h.$('communityPreviewAssets').querySelector('[onerror]'),null);}
 h.$('communityText').value=hostile+' updated';await h.click('communitySubmit');const submitted=[...h.revs.values()].at(-1);assert.equal(submitted.status,'pending');assert.notEqual(submitted.id,saved.id);assert.equal(h.revs.get(saved.id).status,'draft');assert.match(h.$('communityPreviewState').textContent,/pending/);
 }
 assert.equal(h.calls.filter(c=>c[0]==='submit').length,3);assert.equal(h.$('communityReviewControls').hidden,true);
 h.timers.forEach(fn=>fn());assert.equal(h.$('communityPreviewAssets').querySelector('a,img'),null);
 h.logout();assert.equal(h.$('communityPreview').hidden,true);assert.equal(h.$('communityPreviewBody').textContent,'');assert.equal(h.$('communityText').value,'');
 }finally{h.d.window.close();}
});

test('real DOM: rejected deep link shows inert reason and clones a prefilled draft; published edits preserve current version',options,async()=>{
 for(const status of ['rejected','approved']){
 const r=row('article',status);if(status==='approved')r.content_items.published_revision_id=r.id;
 const h=await harness('user',r);try{
 await h.w.CommunityUI.refresh();assert.equal(h.$('communityPreviewBody').querySelector('script,img,svg'),null);
 if(status==='rejected'){assert.ok(h.$('communityPreviewReason').textContent.includes(hostile));assert.equal(h.$('communityPreviewReason').querySelector('img'),null);}
 h.$('communityPreviewActions').querySelector('button').click();await settle();
 const copy=[...h.revs.values()].at(-1);assert.notEqual(copy.id,r.id);assert.equal(copy.status,'draft');assert.equal(h.$('communityText').value,hostile);
 h.$('communityText').value='revised';await h.click('communitySubmit');assert.equal([...h.revs.values()].at(-1).status,'pending');assert.equal(h.revs.get(r.id).status,status);
 if(status==='approved')assert.equal(h.items.get(r.item_id).published_revision_id,r.id);
 }finally{h.d.window.close();}
 }
 const forbidden=row('moment','pending',other),h=await harness('user',forbidden);try{await h.w.CommunityUI.refresh();assert.match(h.$('communityStatus').textContent,/没有访问权限/);assert.equal(h.$('communityPreviewBody').textContent,'');assert.equal(h.$('communityPreview').hidden,true);}finally{h.d.window.close();}
});

test('real DOM: admin queue preview, required rejection reason, approve, user/type thresholds and role clearing',options,async()=>{
 const r=row('moment','pending',other),h=await harness('admin',r);try{
 await h.w.CommunityUI.refresh();assert.equal(h.$('communityReviewControls').hidden,false);await h.click('communityReject');assert.match(h.$('communityStatus').textContent,/拒绝必须填写原因/);assert.equal(h.calls.filter(c=>c[0]==='review').length,0);
 h.$('communityRejectReason').value=hostile;await h.click('communityReject');assert.equal(h.revs.get(r.id).rejection_reason,hostile);assert.equal(h.$('communityPreviewReason').querySelector('script,img'),null);assert.equal(h.$('communityReviewQueue').querySelector('button'),null);
 const next=row('article','pending',other);h.items.set(next.item_id,next.content_items);h.revs.set(next.id,next);h.w.history.replaceState({},'','?revision='+next.id);await h.w.CommunityUI.refresh();await h.click('communityApprove');assert.equal(h.items.get(next.item_id).published_revision_id,next.id);
 h.$('communityPolicyUser').value='other_user';await h.click('communityLoadPolicy');h.$('communityPolicyType').value='album';h.$('communityPolicyThreshold').value='2';await h.click('communitySavePolicy');assert.deepEqual(h.calls.find(c=>c[0]==='threshold'),['threshold',other,'album',2]);
 h.$('communityPolicyThreshold').value='';await h.click('communitySavePolicy');assert.deepEqual(h.calls.filter(c=>c[0]==='threshold').at(-1),['threshold',other,'album',null]);
 h.logout();assert.equal(h.$('communityReviewQueue').textContent,'');assert.equal(h.$('communityPolicyIdentity').textContent,'');
 }finally{h.d.window.close();}
});

test('real DOM: uploading while editing preserves chosen album photos and unsaved captions',options,async()=>{
 const h=await harness();try{await h.w.CommunityUI.refresh();h.w.document.querySelector('[data-new-content="album"]').click();await settle();
 h.$('communityAssetChoices').querySelector('input[type=checkbox]').checked=true;h.$('communityAssetChoices').querySelector('[data-asset-caption]').value='unsaved caption';
 Object.defineProperty(h.$('communityUploadFile'),'files',{value:[new h.w.File(['x'],'new.png',{type:'image/png'})]});await h.click('communityUpload');
 assert.equal(h.$('communityAssetChoices').querySelector('input[type=checkbox]').checked,true);assert.equal(h.$('communityAssetChoices').querySelector('[data-asset-caption]').value,'unsaved caption');assert.equal(h.$('communityAssetChoices').querySelectorAll('input[type=checkbox]').length,2);
 }finally{h.d.window.close();}
});

test('real DOM: ignores a private revision response arriving after logout',options,async()=>{
 const r=row('article'),h=await harness('user',r);try{
 let resolve;h.data.getRevision=()=>new Promise(r=>{resolve=r;});const loading=h.w.CommunityUI.refresh();await settle();h.logout();resolve(r);await loading;
 assert.equal(h.$('communityPreviewBody').textContent,'');assert.equal(h.$('communityPreview').hidden,true);
 }finally{h.d.window.close();}
});

test('data API: fixes upload ownership, disallows upsert/HTML, cleans failed registration and uses 60-second signed URLs only',options,async()=>{
 const d=await dom(),w=d.window,calls=[];let actor={id:user},registrationError=null,url='https://test.supabase.co/storage/v1/object/sign/community-assets/private?token=short';
 const bucket={async upload(path,file,opts){calls.push(['upload',path,opts]);return {data:{path}};},async remove(paths){calls.push(['remove',paths]);return {data:[]};},async createSignedUrl(path,ttl){calls.push(['signed',path,ttl]);return {data:{signedUrl:url}};}};
 const db={storage:{from(name){assert.equal(name,'community-assets');return bucket;}},async rpc(name,args){calls.push(['rpc',name,args]);return registrationError?{error:registrationError}:{data:randomUUID()};},from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:image,object_path:user+'/photo.png',mime_type:'image/png',original_name:'photo.png'}};}};}};
 w.BlogAuth={ready:async()=>{},user:()=>actor,requireUser(){if(!actor)throw Error('Login required');return actor;},client:()=>db};w.BlogConfig={SUPABASE_URL:'https://test.supabase.co'};
 try{w.eval(await read('js/community-schema.js'));w.eval(await read('js/community-data.js'));const api=w.CommunityData;
 await assert.rejects(api.upload(new w.File(['<html>'],'attack.html',{type:'text/html'})),/支持/);assert.equal(calls.length,0);
 const file=new w.File(['data'],'image.png',{type:'image/png'});await api.upload(file);const upload=calls.find(c=>c[0]==='upload');assert.match(upload[1],new RegExp('^'+user+'/[0-9a-f-]+\\.png$'));assert.equal(upload[2].upsert,false);
 const args=calls.find(c=>c[0]==='rpc')[2];assert.deepEqual(Object.keys(args).sort(),['p_object_path','p_original_name']);
 registrationError=Error('registration failed');await assert.rejects(api.upload(file),/registration failed/);assert.equal(calls.filter(c=>c[0]==='remove').length,1);
 const signed=await api.signedAsset(image);assert.match(signed.url,/token=short/);assert.equal(calls.find(c=>c[0]==='signed')[2],60);assert.ok(signed.expiresAt-Date.now()<=60000);
 for(const bad of ['javascript:alert(1)','https://attacker.invalid/steal','http://test.supabase.co/unsafe']){url=bad;await assert.rejects(api.signedAsset(image),/无效资源地址/);}
 actor=null;await assert.rejects(api.upload(file),/Login required/);
 }finally{d.window.close();}
});

test('notification DOM: rejected reason is escaped, valid UUID links to re-edit, forged action UUID is suppressed',options,async()=>{
 const d=await dom('messages.html','https://blog.invalid/messages.html'),w=d.window,id=randomUUID();
 w.BlogTheme={setup(){}};w.BlogAuth={ready:async()=>{},user:()=>({id:user})};w.BlogData={listNotifications:async()=>[
 {type:'content_rejected',revision_id:id,body:hostile,title:hostile},
 {type:'content_rejected',revision_id:'" onclick="alert(1)',body:hostile,title:'bad ID'}],notificationCount:async()=>2,markNotificationsRead:async()=>{}};
 w.MessageData={uuid:id=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||''),unread:async()=>0};
 try{w.eval(await read('js/public-cards.js'));w.eval(await read('js/messages.js'));await settle();const inbox=w.document.getElementById('messagesList');assert.equal(inbox.querySelector('script,[onerror],[onclick]'),null);const actions=inbox.querySelectorAll('a.btn');assert.equal(actions.length,1);assert.match(actions[0].href,new RegExp('account.html\\?revision='+id+'#content'));assert.equal(actions[0].rel,'nofollow');assert.ok(inbox.textContent.includes(hostile));}finally{d.window.close();}
});
