import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reconcile} from '../scripts/sync-community-public.mjs';
const options={skip:!process.env.COMMUNITY_DOM_MODULE&&'Configure jsdom'},read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
const uid='00000001-0000-4000-8000-000000000001';
test('Upgrade gate refuses missing/partial backend before real service API writes and rejects changed actor',options,async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),d=new JSDOM('',{runScripts:'outside-only'}),w=d.window;let actor={id:uid},version=0,writes=0,resolve;
 w.BlogAuth={ready:async()=>{},user:()=>actor,requireUser:()=>actor,client:()=>({rpc:async(name)=>{if(name==='community_capabilities')return version==='wait'?await new Promise(r=>resolve=r):{data:{version}};writes++;return {data:uid};}})};
 try{w.eval(await read('js/community-schema.js'));w.eval(await read('js/backend-capabilities.js'));w.eval(await read('js/community-data.js'));
 for(const v of [0,undefined]){version=v;await assert.rejects(w.CommunityData.create('article','safe','title',{text:'body',category:'杂谈'}),/尚未完成升级/);assert.equal(writes,0);}
 version=20261013;await w.CommunityData.create('article','safe','title',{text:'body',category:'杂谈'});assert.equal(writes,1);
 version='wait';const pending=w.BackendCapabilities.requireUpgrade();while(!resolve)await new Promise(r=>setImmediate(r));actor={id:'00000002-0000-4000-8000-000000000002'};w.document.dispatchEvent(new w.Event('blog-auth-change'));resolve({data:{version:20261013}});await assert.rejects(pending,/账号已变化/);
 }finally{d.window.close();}
 let calls=0;await assert.rejects(reconcile({adapter:{preflight:async()=>{throw Error('upgrade required');},export:async()=>{calls++;return [];},result:async()=>calls++}}),/upgrade required/);assert.equal(calls,0);
});
test('Controlled HTML source roundtrips safe formats, rejects head scripts, handlers and unsupported nodes',options,async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),d=new JSDOM('<div id="editor"></div><div id="tools"></div>',{runScripts:'outside-only'}),w=d.window;
 try{w.eval(await read('js/community-schema.js'));w.eval(await read('js/content-editor.js'));const editor=w.ContentEditor.create({editor:w.document.getElementById('editor'),toolbar:w.document.getElementById('tools')});
 const html='<h2>标题</h2><p><strong>粗体</strong><em>斜体</em><a href="https://example.org/">链接</a> $$x^2$$</p><ol><li>第一</li></ol><pre>code</pre>';
 const doc=editor.parseSource(html,[]);editor.setBody({document:doc,asset_ids:[]});assert.deepEqual(editor.parseSource(editor.getSource(),[]),doc);
 for(const bad of ['<script>alert(1)</script><p>safe</p>','<meta http-equiv="refresh" content="0;url=evil"><p>x</p>','<p onclick="x">body</p>','<iframe src="https://example.org"></iframe>','<p><a href="javascript:1">bad</a></p>','<table><tr><td>silently lost</td></tr></table>'])assert.throws(()=>editor.parseSource(bad,[]));
 }finally{d.window.close();}
});
test('Avatar, notification, DM and review badges have independent counts; transient failure keeps known state',options,async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),d=new JSDOM('<button class="user-avatar"><span class="menu-badge"></span></button><span class="notification-badge"></span><span class="dm-badge"></span><span class="review-badge"></span>',{runScripts:'outside-only'}),w=d.window;let actor={id:uid},failed=false;
 w.BlogAuth={user:()=>actor,isAdmin:()=>true};w.BlogData={notificationCount:async()=>{if(failed)throw Error('transient');return 3;},dmUnreadCount:async()=>2,reviewCount:async()=>7};
 try{const src=await read('js/site.js');w.eval('(function(){'+src.slice(src.indexOf('  function updatePendingBadge('),src.indexOf('  function setupRail()'))+'window.refresh=refreshNotificationBadge;window.pending=refreshPendingBadge;})();');const settle=async()=>{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));};w.refresh();w.pending();await settle();const value=s=>w.document.querySelector(s).textContent;assert.equal(value('.user-avatar .menu-badge'),'5');assert.equal(value('.notification-badge'),'3');assert.equal(value('.dm-badge'),'2');assert.equal(value('.review-badge'),'7');failed=true;w.refresh();await settle();assert.equal(value('.user-avatar .menu-badge'),'5');assert.equal(value('.notification-badge'),'3');actor=null;w.refresh();w.pending();await settle();assert.ok([...w.document.querySelectorAll('span')].every(n=>n.hidden));
 }finally{d.window.close();}
});
