import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const options={skip:!(process.env.BROWSER_TEST_MODULE&&process.env.BROWSER_TEST_EXECUTABLE)&&'Set browser environment for real 375px rendering.'};
const user='00000001-0000-4000-8000-000000000001',other='00000002-0000-4000-8000-000000000002',thread='00000005-0000-4000-8000-000000000005';
const attack='长文本'+ 'x'.repeat(700)+'<script>window.compromised=1</script>';
const profile={id:other,username:'other_user',display_name:attack,avatar_url:'assets/avatar-default.jpg',bio:attack};
async function mock(page,role){
 const scripts={
  'auth.js':`window.BlogAuth={ready:async()=>{},configured:()=>true,user:()=>(${role==='guest'?'null':JSON.stringify({id:user})}),isAdmin:()=>${role==='admin'},requireUser(){if(!this.user())throw Error('Login required');return this.user();},requireAdmin(){if(!this.isAdmin())throw Error('Admin required');},signOut:async()=>{},resetPassword:async()=>{}};`,
  'blog-data.js':`window.BlogData={getProfile:async()=>(${JSON.stringify(profile)}),notificationCount:async()=>7,dmUnreadCount:async()=>3,messageUnreadCount:async()=>9,followerCount:async()=>2,following:async()=>false,toggleFollow:async()=>true,listNotifications:async(offset)=>Array.from({length:offset?5:20},(_,i)=>({id:'${thread}',type:'comment_rejected',comment_id:'${thread}',title:${JSON.stringify(attack)},body:${JSON.stringify(attack)},actorUsername:'other_user',actorName:${JSON.stringify(attack)},read:false,created_at:'2026-10-07'})),markNotificationsRead:async()=>{}};`,
  'message-data.js':`window.MessageData={uuid:id=>/^[0-9a-f-]{36}$/.test(id||''),getThread:async()=> '${thread}',threadInfo:async()=>({id:'${thread}',peer:${JSON.stringify(profile)}}),threads:async()=>[{id:'${thread}',...${JSON.stringify(profile)},unread_count:3,last_message_at:'2026-10-07'}],messages:async(id,before)=>Array.from({length:before?1:20},(_,i)=>({id:'message-'+(before?0:20-i),message_no:before?1:21-i,sender_id:i%2?'${user}':'${other}',body:${JSON.stringify(attack)},created_at:'2026-10-07',assets:i===0?[{id:'${thread}',original_name:${JSON.stringify(attack)}}]:[]})),signedAsset:async()=>({url:location.origin+'/assets/avatar-default.jpg',expiresAt:Date.now()+60000}),markRead:async()=>{},unread:async()=>3,upload:async(file)=>({id:'${thread}',original_name:file.name}),send:async()=>{},unsent:async()=>[{id:'${thread}',original_name:${JSON.stringify(attack)},size_bytes:200}],orphans:async()=>[{object_id:'${thread}',object_path:'${user}/'+${JSON.stringify(attack)}}],removeAsset:async()=>{},removeOrphan:async()=>{}};`,
  'public-profile-data.js':`window.PublicProfileData={profile:async()=>(${JSON.stringify(profile)}),counts:async()=>[2,3],content:async()=>[],legacy:()=>[]};`,
  'community-data.js':`window.CommunityData={listItems:async()=>[],listAssets:async()=>[],assetsPage:async()=>[],orphans:async()=>[],listReviews:async()=>[]};`,
  'comment-edit-data.js':`window.CommentEditData={mine:async()=>[],queue:async()=>[]};`
 };
 Object.values(scripts).forEach(s=>new Function(s));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){await route.abort();return;}const script=scripts[url.pathname.split('/').at(-1)];if(script)await route.fulfill({contentType:'text/javascript',body:script});else await route.continue();});
}
async function noOverflow(page,label){const width=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,5).map(e=>e.id||e.className)}));assert.ok(width.width<=375,label+': '+JSON.stringify(width));assert.equal(await page.evaluate(()=>window.compromised),undefined);}
test('Round 4 Chrome 375px: notification/DM tabs, safe conversation/history/images, profile entry and account unread counts',options,async()=>{
 const imported=await import(process.env.BROWSER_TEST_MODULE),chromium=imported.chromium||imported.default.chromium;
 const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root))throw Error('Path');const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(body);}catch(e){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_TEST_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const role of ['user','admin']){
   const page=await browser.newPage({viewport:{width:375,height:812}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await mock(page,role);
   await page.goto(base+'/messages.html');await page.waitForFunction(()=>document.getElementById('messagesList').children.length===20);await noOverflow(page,role+' notifications');
   await page.locator('#notificationNext').click();await page.waitForFunction(()=>document.getElementById('messagesList').children.length===5);await noOverflow(page,'notifications second page');
   await page.locator('#dmTab').click();await page.locator('#dmThreads button').click();await page.waitForFunction(()=>document.querySelectorAll('#dmHistory .dm-message').length===20);
   await page.waitForSelector('#dmHistory .dm-image');assert.equal(await page.locator('#dmHistory .dm-mine').count(),10);assert.equal(await page.locator('#dmHistory .dm-theirs').count(),10);await noOverflow(page,role+' chat');
   await page.locator('#dmOlder').click();await page.waitForFunction(()=>document.querySelectorAll('#dmHistory .dm-message').length===21);
   await page.locator('#dmImages').setInputFiles({name:'image.png',mimeType:'image/png',buffer:Buffer.from('image fixture')});await page.waitForFunction(()=>document.getElementById('dmAttachments').textContent.includes('image.png'));
   await page.locator('#dmBody').fill(attack);await noOverflow(page,'composer image/text');await page.locator('#dmSend').click();await page.waitForFunction(()=>document.getElementById('dmBody').value==='');
   await page.locator('.dm-unsent summary').click();await page.locator('#dmAssetsRefresh').click();await page.waitForSelector('#dmUnsent article');await noOverflow(page,'unsent/orphan images');
   await page.goto(base+'/profile.html?username=other_user');await page.waitForFunction(()=>!!document.getElementById('profileMessage').getAttribute('href'));assert.match(await page.locator('#profileMessage').getAttribute('href'),new RegExp('messages.html\\?user='+other));await noOverflow(page,'profile private message entry');
   await page.locator('#profileMessage').click();await page.waitForSelector('#dmHistory .dm-message');assert.match(page.url(),/thread=/);await noOverflow(page,'auto-created thread');
   await page.goto(base+'/account.html');await page.waitForFunction(()=>document.getElementById('accountDMCount').textContent==='3 条未读私信');assert.equal(await page.locator('#accountNotificationCount').textContent(),'7 条未读通知');await noOverflow(page,'account unread');
   assert.deepEqual(errors,[]);await page.close();
  }
  const guest=await browser.newPage({viewport:{width:375,height:812}});await mock(guest,'guest');await guest.goto(base+'/profile.html?username=other_user');await guest.waitForFunction(()=>!!document.getElementById('profileMessage').getAttribute('href'));assert.match(await guest.locator('#profileMessage').getAttribute('href'),/login.html\?next=messages.html%3Fuser%3D/);await noOverflow(guest,'guest message entry');await guest.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
