import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('Chromium: current public avatars reach existing static pages on desktop and mobile without Publisher',{skip:!process.env.BROWSER_TEST_MODULE||!process.env.BROWSER_TEST_EXECUTABLE},async()=>{
 const {chromium}=await import(process.env.BROWSER_TEST_MODULE);
 const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(path.relative(root,file).startsWith('..'))throw Error('Path');const bytes=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch(e){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_TEST_EXECUTABLE,headless:true});
 try{
 const posts=(await readdir(path.join(root,'posts'))).filter(p=>p.endsWith('.html'));
 for(const width of [375,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/auth.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.BlogAuth={ready:async()=>{},configured:()=>false,user:()=>null,isAdmin:()=>false};'}));
  await page.route('**/albums.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SITE_ALBUMS=[{id:"public-test",title:"Local fixture",created:"2026-10-31",visibility:"public",photos:[{src:"assets/icon.jpg"}]}];'}));
  await page.route('https://hscqeswnscnvkdthhlfp.supabase.co/**',r=>{
   const url=new URL(r.request().url());
   if(r.request().method()==='OPTIONS')return r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey'}});
   if(url.pathname==='/rest/v1/profiles'){
    // 按请求里实际询问的身份回填，避免把作者写死成站长（新文章可能是别的作者）。
    const cors={'Access-Control-Allow-Origin':'*'};
    const stamp=base+'/assets/avatar-default.jpg?current=1';
    const rows=[];
    const idQ=url.searchParams.get('id');
    if(idQ)for(const m of idQ.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi))rows.push({id:m[0],avatar_url:stamp});
    const nameQ=url.searchParams.get('username');
    if(nameQ)for(const m of nameQ.matchAll(/[a-zA-Z0-9_]{3,30}/g)){if(!/^(in|eq|not|is|null|true|false)$/i.test(m[0]))rows.push({username:m[0],avatar_url:stamp});}
    return r.fulfill({json:rows.length?rows:[{username:'hshspacex',avatar_url:stamp}],headers:cors});
   }
   return r.abort();
  });
  // 分类名不再硬编码：从公开快照取第一篇已发布文章的真实分类，避免数据改动后筛选为空。
  const snapshot=JSON.parse(await readFile(path.join(root,'data/community-public.json'),'utf8'));
  const sample=snapshot.items.find(i=>i.content_type==='article'&&i.body&&i.body.category);
  const archiveUrl='/archive.html?category='+encodeURIComponent(sample.body.category);
  for(const url of ['/index.html','/posts/'+posts[0],'/moments.html','/timeline.html',archiveUrl,'/gallery.html']){
   await page.goto(base+url);try{await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('img[data-avatar-user]')];return imgs.length>0&&imgs.some(i=>i.src.includes('current=1'));},{},{timeout:8000});}catch(e){throw Error(url+': '+await page.locator('img[data-avatar-user]').evaluateAll(images=>JSON.stringify(images.map(i=>({user:i.dataset.avatarUser,src:i.src}))))+' errors='+JSON.stringify(errors));}
   assert.equal(await page.locator('img[data-avatar-user]').evaluateAll(images=>images.every(i=>i.src.includes('current=1'))),true,url);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),url+' overflow');
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
