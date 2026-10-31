import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/public-cards.js',import.meta.url),'utf8');
test('public avatars refresh by existing identity, batch reads, protect URLs and preserve offline fallback',{skip:!process.env.COMMUNITY_DOM_MODULE},async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('<div id="cards"></div>',{url:'https://blog.example/posts/old',runScripts:'outside-only'}),w=dom.window;
 try{
  w.document.head.innerHTML='<base href="../">';w.BlogConfig={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test'};
  const calls=[];let fail=false;
  w.fetch=async(url,options)=>{calls.push({url,options});if(fail)throw Error('offline');const u=new URL(url),field=u.searchParams.has('id')?'id':'username';return {ok:true,json:async()=>field==='id'?[{id:'00000001-0000-4000-8000-000000000001',avatar_url:'https://cdn.example/member-new.png'}]:[{username:'hshspacex',avatar_url:'https://cdn.example/owner-new.png'},{username:'hostile',avatar_url:'javascript:alert(1)'}]};};
  w.eval(source);const cards=w.document.getElementById('cards');
  cards.append(w.PublicCards.author({username:'hshspacex',display_name:'历史作者',avatar_url:'assets/icon.jpg'}),w.PublicCards.author({username:'member',id:'00000001-0000-4000-8000-000000000001',avatar_url:'assets/icon.jpg'}),w.PublicCards.author({username:'hostile',avatar_url:'assets/icon.jpg'}));
  await new Promise(r=>setTimeout(r,30));
  assert.match(cards.children[0].querySelector('img').src,/owner-new/);assert.match(cards.children[1].querySelector('img').src,/member-new/);
  assert.match(cards.children[2].querySelector('img').src,/avatar-default/);assert.match(cards.children[0].textContent,/历史作者/);
  assert.equal(calls.length,2);for(const c of calls){assert.equal(c.options.credentials,'omit');assert.equal(c.options.headers.Authorization,undefined);assert.match(c.url,/select=(id|username)%2Cavatar_url/);}
  cards.append(w.PublicCards.author({username:'hshspacex',avatar_url:'assets/icon.jpg'}));await new Promise(r=>setTimeout(r,30));assert.match(cards.lastChild.querySelector('img').src,/owner-new/);assert.equal(calls.length,2);
  fail=true;cards.append(w.PublicCards.author({username:'offline',avatar_url:'assets/icon.jpg'}));await new Promise(r=>setTimeout(r,30));assert.equal(cards.lastChild.querySelector('img').src,'https://blog.example/assets/icon.jpg');
  for(const url of ['javascript:alert(1)','data:image/svg+xml,x','https://u:p@evil.example/x','https://project.supabase.co/storage/v1/object/sign/private/x?token=x'])assert.equal(w.PublicCards.avatar(url),'assets/avatar-default.jpg');
 }finally{w.close();}
});
