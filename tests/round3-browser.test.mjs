import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {serve,fixtures,sizes,options,uid} from './helpers/release-browser.mjs';
const evidence=process.env.GUI_EVIDENCE_DIR?path.resolve(process.env.GUI_EVIDENCE_DIR,'..'):null;
async function Browser_Capture(page,name){if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:false});}}
async function Browser_Layout(page,label){const m=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,theme:document.documentElement.dataset.theme}));assert.ok(m.width<=m.viewport,label+': '+JSON.stringify(m));return m;}
test('Round 3 Chromium: final public pages and account modules across four sizes, five identities and both themes',options,async()=>{
 const {server,base}=await serve(),{chromium}=await import(process.env.BROWSER_TEST_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_TEST_EXECUTABLE,headless:true}),metrics=[];
 try{for(const role of ['guest','user-a','user-b','admin-a','admin-b'])for(const [width,height] of sizes){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await fixtures(page,role.startsWith('admin')?'admin':'user');
  await page.addInitScript(({role,uid})=>{let auth;Object.defineProperty(window,'BlogAuth',{get:()=>auth,set(v){window.__actor=role==='guest'?null:{id:role.endsWith('-b')?'00000002-0000-4000-8000-000000000002':uid};auth=v;}});}, {role,uid});
  for(const [index,url] of ['index.html','archive.html','featured.html','search.html?q=奥匈&type=post&featured=1','posts/post-austria-history.html','moments.html','gallery.html','profile.html?username=test_user'].entries()){
   await page.goto(base+'/'+url);await page.locator('body').waitFor();await page.evaluate(t=>document.documentElement.dataset.theme=t,index%2?'dark':'light');metrics.push({role,url,...await Browser_Layout(page,role+' '+url+' '+width)});
   if(role==='guest'&&(width===375||width===1440))await Browser_Capture(page,'final-'+url.split(/[.?/]/).join('-')+'-'+width);
  }
  await page.goto(base+'/account.html#overview');
  if(role==='guest'){assert.equal(await page.locator('#accountWorkspace').isVisible().catch(()=>false),false);await page.close();continue;}
  await page.waitForSelector('#directoryToggle');
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);if(await page.locator('#directoryToggle').getAttribute('aria-expanded')!=='true')await page.locator('#directoryToggle').click();await page.waitForFunction(()=>document.getElementById('directoryToggle').getAttribute('aria-expanded')==='true');
   const colors=await page.locator('#accountDirectory [aria-current=page]').evaluate(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {color:s.color,background:s.backgroundColor,height:r.height,svg:n.querySelector('svg')?.getBoundingClientRect().width};});assert.notEqual(colors.color,'rgba(0, 0, 0, 0)');assert.ok(colors.svg>0);metrics.push({role,width,theme,directory:colors});await Browser_Capture(page,'final-directory-'+role+'-'+width+'-'+theme);await page.keyboard.press('Escape');
  }
  const modules=['articles','moments','albums','assets','notifications','direct-messages','trash'];if(role.startsWith('admin'))modules.push('review-center','review-policies','featured-management','site-settings');
  for(const module of modules){await page.evaluate(r=>window.AccountRoute.navigate(r),module);await page.waitForFunction(r=>document.getElementById('accountSections').dataset.activeModule===r,module);metrics.push({role,module,...await Browser_Layout(page,role+' '+module+' '+width)});}
  assert.deepEqual(errors,[],role+' '+width+' script errors');await page.close();
 }}finally{if(evidence)await writeFile(path.join(evidence,'round3-matrix.json'),JSON.stringify(metrics,null,2));await browser.close();await new Promise(r=>server.close(r));}
});
test('Round 3 Chromium: missing new admin RPC preserves draft and login, then safely retries the same revision',options,async()=>{
 const {server,base}=await serve(),{chromium}=await import(process.env.BROWSER_TEST_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_TEST_EXECUTABLE,headless:true});try{
  const page=await browser.newPage({viewport:{width:375,height:812},reducedMotion:'reduce'});await fixtures(page,'admin');await page.addInitScript(()=>{let data;Object.defineProperty(window,'CommunityData',{get:()=>data,set(v){const save=v.saveFeaturedPreference;v.saveFeaturedPreference=async(...args)=>{if(!window.__backendUpgraded)throw Error('当前 Supabase 缺少第二轮 RPC，请站长完成数据库升级；操作未完成。');return save(...args);};data=v;}});});
  await page.goto(base+'/account.html#articles');await page.locator('[data-new-content=article]').click();await page.locator('#communityTitle').fill('数据库尚未升级时保留的文章');await page.locator('#communityRichEditor').fill('正文必须保留，不能重复创建版本。');await page.locator('#communitySettingsToggle').click();await page.locator('#communityFeatured').check();await page.locator('#communitySubmit').click();await page.waitForFunction(()=>document.getElementById('communityStatus').textContent.includes('数据库升级'));
  const before=await page.evaluate(()=>({count:Object.keys(window.__revs).length,saves:window.__saves.length,actor:window.BlogAuth.user().id,dirty:document.getElementById('communityEditor').dataset.dirty}));assert.equal(before.count,1);assert.equal(before.dirty,'true');assert.equal(before.actor,uid);assert.match(await page.locator('#communityRichEditor').textContent(),/正文必须保留/);await page.locator('#communityStatus').scrollIntoViewIfNeeded();await Browser_Capture(page,'final-backend-upgrade-required');
  await page.evaluate(()=>window.__backendUpgraded=true);await page.locator('#communitySubmit').click();await page.waitForFunction(()=>Object.values(window.__revs)[0]?.status==='approved');assert.equal(await page.evaluate(()=>Object.keys(window.__revs).length),1);assert.equal(await page.evaluate(()=>window.__saves.length),before.saves);assert.ok(!/网站已发布|Pages 已部署/.test(await page.locator('#communityStatus').textContent()));await Browser_Capture(page,'final-backend-retry-approved');await page.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
