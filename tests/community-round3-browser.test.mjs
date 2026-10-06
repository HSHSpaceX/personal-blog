import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const configured=process.env.BROWSER_TEST_MODULE&&process.env.BROWSER_TEST_EXECUTABLE;
const root=fileURLToPath(new URL('../',import.meta.url));
const uid='00000001-0000-4000-8000-000000000001',other='00000002-0000-4000-8000-000000000002';
const long='长名称'+ 'x'.repeat(600)+'<script>window.compromised=1</script>';
const profile={id:other,username:'other_user',display_name:long,bio:long,avatar_url:'assets/avatar-default.jpg'};
async function mock(page,role){
 const card={kind:'article',target_type:'content',target_id:uid,title:long,text:long,username:'other_user',display_name:long,published_at:'2026-10-06',target_path:'profile.html?username=other_user'};
 const scripts={
 'albums.js':`window.SITE_ALBUMS=[{id:'public-album',title:'公开图册',created:'2026-10-06',visibility:'public',photos:[]},{id:'private-album',title:'私有图册',created:'2026-10-06',visibility:'private',photos:[]}];`,
 'auth.js':`window.BlogAuth={ready:async()=>{},configured:()=>true,user:()=>(${role==='guest'?'null':JSON.stringify({id:uid,email:'test@example.invalid'})}),isAdmin:()=>${role==='admin'},requireUser(){if(!this.user())throw Error('Login required');return this.user();},requireAdmin(){if(!this.isAdmin())throw Error('Admin required');return this.user();},signOut:async()=>{},resetPassword:async()=>{}};`,
 'blog-data.js':`window.BlogData={getProfile:async()=>(${JSON.stringify(profile)}),following:async()=>false,toggleFollow:async()=>true,toggleLike:async()=>true,notificationCount:async()=>0,followerCount:async()=>2,likes:async()=>({}),listComments:async()=>[],listLatestComments:async()=>[]};`,
 'public-profile-data.js':`window.PublicProfileData={profile:async()=>(${JSON.stringify(profile)}),counts:async()=>[2,3],legacy:()=>[],resolveLegacy:r=>r,content:async(id,type,offset)=>Array.from({length:offset?1:20},()=>({...${JSON.stringify(card)},kind:type,body:type==='album'?{photos:[{asset_id:'${uid}'}]}:undefined})),followers:async()=>Array(20).fill(${JSON.stringify(profile)}),following:async()=>Array(20).fill(${JSON.stringify(profile)}),likes:async()=>[${JSON.stringify(card)}]};`,
 'community-data.js':`window.CommunityData={listItems:async()=>[],listAssets:async()=>[],listReviews:async()=>[],assetsPage:async()=>Array.from({length:20},()=>({id:'${uid}',original_name:${JSON.stringify(long)},mime_type:'image/png',size_bytes:100,created_at:'2026-10-06',reference_count:3})),orphans:async()=>[{object_id:'${uid}',object_path:'${uid}/'+${JSON.stringify(long)}}],signedAsset:async()=>({url:location.origin+'/assets/avatar-default.jpg',expiresAt:Date.now()+60000})};`,
 'comment-edit-data.js':`window.CommentEditData={mine:async()=>[{id:'${uid}',post_slug:${JSON.stringify(long)},content:${JSON.stringify(long)},status:'approved',created_at:'2026-10-06'}],queue:async()=>[{id:'${uid}',previous_content:${JSON.stringify(long)},proposed_content:${JSON.stringify(long)},created_at:'2026-10-06',status:'pending'}]};`
 };
 Object.values(scripts).forEach(script=>new Function(script));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'){await route.abort();return;}const file=u.pathname.split('/').at(-1);if(scripts[file])await route.fulfill({contentType:'text/javascript',body:scripts[file]});else await route.continue();});
}
async function overflow(page){return page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>!e.hidden&&e.getBoundingClientRect().width&&e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width}))}));}
test('Chromium 375px: public profile tabs/user cards, own account editor/resources/review and legacy authors have no horizontal overflow',{
 skip:!configured&&'Set BROWSER_TEST_MODULE and BROWSER_TEST_EXECUTABLE for actual 375px layout validation.'
},async()=>{
 const imported=await import(process.env.BROWSER_TEST_MODULE),chromium=imported.chromium||imported.default.chromium;
 const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root))throw Error('Path');const data=await readFile(file);const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'})[ext]||'application/octet-stream');res.end(data);}catch(e){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_TEST_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 for(const role of ['guest','user','admin']){const page=await browser.newPage({viewport:{width:375,height:812}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await mock(page,role);await page.goto(base+'/profile.html?username=other_user');try{await page.waitForFunction(()=>document.getElementById('profileCards').children.length===20,{},{timeout:5000});}catch(e){throw Error(role+': '+JSON.stringify({errors,status:await page.locator('#profileStatus').textContent()}));}
 for(const tab of ['moment','article','comment','album','likes']){await page.locator('[data-profile-tab="'+tab+'"]').click();await page.waitForTimeout(30);const result=await overflow(page);assert.ok(result.width<=375,role+' '+tab+': '+JSON.stringify(result));}
 await page.locator('#profileFollowers').click();await page.waitForTimeout(30);assert.ok((await overflow(page)).width<=375);assert.equal(await page.evaluate(()=>window.compromised),undefined);assert.deepEqual(errors,[]);await page.close();}
 const account=await browser.newPage({viewport:{width:375,height:812}});await mock(account,'admin');await account.goto(base+'/account.html');await account.waitForFunction(()=>document.getElementById('assetCenterList').children.length===20);await account.locator('[data-new-content="article"]').click();await account.locator('#communityText').fill(long);const layout=await overflow(account);assert.ok(layout.width<=375,'account: '+JSON.stringify(layout));assert.equal(await account.evaluate(()=>window.compromised),undefined);await account.close();
 const legacy=await browser.newPage({viewport:{width:375,height:812}});await mock(legacy,'guest');await legacy.goto(base+'/moments.html');await legacy.waitForSelector('.moment-name');assert.match(await legacy.locator('.moment-name').first().textContent(),/HSH\(站长\).*hshspacex/);assert.match(await legacy.locator('a.moment-avatar').first().getAttribute('href'),/profile.html\?username=hshspacex/);await legacy.goto(base+'/gallery.html');await legacy.waitForSelector('.album-card');assert.equal(await legacy.locator('.album-card').count(),1);assert.match(await legacy.locator('.album-card .public-author').getAttribute('href'),/profile.html\?username=hshspacex/);await legacy.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
