import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {desiredSnapshot} from '../scripts/sync-community-public.mjs';
import {fixture,ids,attack} from './fixtures/community-publish/source.mjs';
const options={skip:!process.env.COMMUNITY_DOM_MODULE&&'Configure jsdom.'},read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('Round 5 DOM: publication statuses, category editing/validation/logout, safe article/media/author nodes and real routes',options,async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM(await read('account.html'),{url:'https://fixture.invalid/account.html',runScripts:'outside-only'}),w=dom.window;let actor={id:ids.author};
 const rows=['pending','published','failed'].map((status,i)=>({id:ids.article,content_type:'article',slug:'article',author_id:ids.author,published_revision_id:ids.revision,community_publication_state:i===0?[{status}]:{status},content_revisions:[{id:ids.revision,status:'approved',title:attack}]}));
 w.BlogAuth={user:()=>actor,isAdmin:()=>false,ready:async()=>{},requireUser(){if(!actor)throw Error('Login required');return actor;}};
 w.CommunityData={listItems:async()=>rows,listAssets:async()=>[],getRevision:async()=>({id:ids.revision,title:'original',status:'draft',body:{text:'text',category:'保留分类'},content_items:rows[0]})};
 try{w.eval(await read('js/community-schema.js'));w.eval(await read('js/community-ui.js'));await w.CommunityUI.refresh();const items=w.document.getElementById('communityItems');assert.ok(items.textContent.includes('已审核，等待站点同步'));assert.ok(items.textContent.includes('已发布'));assert.ok(items.textContent.includes('发布失败 / 等待重试'));assert.equal(items.querySelector('script,[onerror]'),null);
 w.document.querySelector('[data-new-content="article"]').click();await new Promise(r=>setTimeout(r,5));assert.equal(w.document.getElementById('communityCategory').value,'用户投稿');
 for(const category of ['', '<img>', 'x'.repeat(41)])assert.throws(()=>w.CommunitySchema.validate('article','title',{text:'text',category}));assert.doesNotThrow(()=>w.CommunitySchema.validate('article','title',{text:'text'}));
 actor=null;w.CommunityUI.clear();assert.equal(items.textContent,'');assert.equal(w.document.getElementById('communityCategory').value,'');
 const {snapshot}=await desiredSnapshot(fixture().rows,fixture().adapter);w.eval(await read('js/community-public.js'));const article=w.document.createElement('div');article.innerHTML=w.CommunityPublic.articleHTML(snapshot.items[0]);assert.ok(article.textContent.includes('<script>'));assert.equal(article.querySelector('script,[onerror]'),null);assert.ok([...article.querySelectorAll('img')].every(i=>i.alt.trim()));assert.ok([...article.querySelectorAll('a')].every(a=>a.href.includes('/object/public/published-media/')));assert.equal(w.compromised,undefined);
 const author=w.document.createElement('div');author.innerHTML=w.CommunityPublic.authorHTML(snapshot.items[0].author);assert.equal(author.querySelector('a').getAttribute('href'),'profile.html?username=member_user');assert.equal(w.CommunityPublic.target(snapshot.items[2]),'gallery.html?community='+ids.album);
 }finally{dom.window.close();}
});
