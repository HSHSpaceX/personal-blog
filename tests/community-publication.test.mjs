import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {reconcile,desiredSnapshot,validateMedia,legacyCatalogue,serviceAdapter} from '../scripts/sync-community-public.mjs';
import {fixture,ids,attack} from './fixtures/community-publish/source.mjs';
const require=createRequire(import.meta.url),publicData=require('../js/community-public.js'),search=require('../js/search-core.js');
const root=new URL('../',import.meta.url),sha='a'.repeat(40);
export async function fixtureSite(){const directory=await mkdtemp('/tmp/community-publication-');await cp(root,directory,{recursive:true,filter:src=>!/(?:^|\/)(?:\.git|node_modules)(?:\/|$)/.test(src)});await writeFile(directory+'/data/community-public.json',JSON.stringify({version:1,items:[]},null,2)+'\n');return directory;}
function generate(dir){execFileSync(process.execPath,['scripts/generate-site.mjs'],{cwd:dir,stdio:'pipe'});}
test('publisher full desired state: current pointer only, referenced media only, stable identity, idempotence, replacement/deletion and cleanup',async()=>{
 const f=fixture(),dir=await fixtureSite();try{
  const first=await reconcile({adapter:f.adapter,directory:dir});assert.equal(first.changed,true);const text=await readFile(dir+'/data/community-public.json','utf8');assert.doesNotMatch(text,/PRIVATE_|object\/sign|token=|owner_id|object_path|storage_metadata|dm-media/);assert.equal(first.snapshot.items.length,3);assert.equal(first.snapshot.items[0].revision_id,ids.revision);assert.equal(f.calls.filter(c=>c[0]==='download').length,10);assert.ok(f.calls.filter(c=>c[0]==='download').every(c=>c[1]==='community-assets'));assert.ok(f.results.every(r=>r[2]==='pending'));
  generate(dir);const generated=await readFile(dir+'/posts/community-first-article.html','utf8');assert.ok(generated.includes('&lt;script&gt;window.compromised=1&lt;/script&gt;'));assert.doesNotMatch(generated,/<script>window\.compromised|<img src=x onerror/);assert.match(generated,/profile.html\?username=member_user/);assert.match(generated,/article:published_time/);assert.match(generated,/https:\/\/hsh-personal-blog.pages.dev\/posts\/community-first-article/);
  const js=await readFile(dir+'/js/community-published.js','utf8');assert.ok(!js.includes('</script>'));assert.doesNotMatch(js,/service_role|PRIVATE_/);execFileSync(process.execPath,['scripts/check-seo.mjs'],{cwd:dir,stdio:'pipe'});
  assert.equal((await reconcile({adapter:f.adapter,directory:dir})).changed,false);assert.equal(await readFile(dir+'/data/community-public.json','utf8'),text);generate(dir);assert.equal(await readFile(dir+'/posts/community-first-article.html','utf8'),generated);
  await reconcile({adapter:f.adapter,directory:dir,finalize:true,commitSHA:sha});assert.ok(f.results.some(r=>r[2]==='published'&&r[3]===sha));
  // A new pending edit is absent from authority export, so old published remains.
  assert.equal((await reconcile({adapter:f.adapter,directory:dir})).snapshot.items[0].revision_id,ids.revision);
  f.rows[0]={...f.rows[0],revision_id:ids.pending,body:{text:'NEW_APPROVED',category:'新分类',asset_ids:[]},assets:[]};
  const changed=await reconcile({adapter:f.adapter,directory:dir});assert.equal(changed.snapshot.items[0].revision_id,ids.pending);assert.ok(f.objects.size===10,'old public media kept until successful push');generate(dir);assert.doesNotMatch(await readFile(dir+'/posts/community-first-article.html','utf8'),/window.compromised/);
  await reconcile({adapter:f.adapter,directory:dir,finalize:true,commitSHA:sha});assert.ok([...f.objects.keys()].every(n=>!n.includes(ids.article)));assert.equal(f.calls.filter(c=>c[0]==='remove').length,6);
  f.rows=[];await reconcile({adapter:f.adapter,directory:dir});generate(dir);await assert.rejects(readFile(dir+'/posts/community-first-article.html'),/ENOENT/);await reconcile({adapter:f.adapter,directory:dir,finalize:true,commitSHA:sha});assert.equal(f.objects.size,0);assert.ok(f.calls.filter(c=>c[0]==='remove').every(c=>c[1]==='published-media'));assert.doesNotMatch(await readFile(dir+'/sitemap.xml','utf8'),/community-first-article/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('publisher all validation precedes publication: MIME/magic/metadata/path/double extension/schema/collision/signed URL failures are redacted',async()=>{
 const f=fixture();const a=f.rows[0].assets[0],bytes=f.files[0].bytes;
 for(const change of [{mime_type:'image/svg+xml'},{original_name:'attack.html.png'},{original_name:'../image.png'},{object_path:ids.author+'/../a.png'},{object_path:ids.author+'/a.svg.png'},{size_bytes:20971521},{storage_metadata:{mimetype:'text/html',size:bytes.length}}])assert.throws(()=>validateMedia({...a,...change},bytes),/INVALID_MEDIA/);
 for(const type of ['image/jpeg','image/png','image/webp','application/pdf','video/mp4']){const original=f.rows[0].assets.find(a=>a.mime_type===type);assert.throws(()=>validateMedia({...original,size_bytes:12,storage_metadata:{size:12,mimetype:type}},Buffer.alloc(12)),/INVALID_MEDIA/);}
 for(const change of [{slug:'../escape'},{published_at:'2026-10-07 (" onmouseover="attack)'},{body:{text:'x',html:attack}},{assets:[{...a,bucket_id:'dm-media'}]}]){const rows=structuredClone(f.rows);rows[0]={...rows[0],...change};await assert.rejects(desiredSnapshot(rows,f.adapter),/INVALID_/);}
 const rows=structuredClone(f.rows);rows[0].body.text='https://fixture.invalid/storage/v1/object/sign/a?token=private';await assert.rejects(desiredSnapshot(rows,f.adapter),/INVALID_SNAPSHOT/);
 const dir=await fixtureSite();try{const before=await readFile(dir+'/data/community-public.json','utf8');f.rows[0].slug='post-austria-history';await assert.rejects(reconcile({adapter:f.adapter,directory:dir}),/INVALID_SNAPSHOT/);assert.equal(f.objects.size,0);assert.equal(await readFile(dir+'/data/community-public.json','utf8'),before);assert.ok(f.results.every(r=>r[2]==='failed'&&r[4]==='INVALID_SNAPSHOT'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('interrupted upload/finalize safely retries, no early published status, no stale revision finalization',async()=>{
 const f=fixture(),dir=await fixtureSite(),upload=f.adapter.uploadPublic;let calls=0;
 try{f.adapter.uploadPublic=async(...args)=>{if(++calls===3)throw Error('sensitive remote error fixture');return upload(...args);};await assert.rejects(reconcile({adapter:f.adapter,directory:dir}),e=>e.message==='EXPORT_FAILED');assert.equal(f.results.some(r=>r[2]==='published'),false);assert.equal(JSON.parse(await readFile(dir+'/data/community-public.json','utf8')).items.length,0);
 f.adapter.uploadPublic=upload;await reconcile({adapter:f.adapter,directory:dir});const expected=await readFile(dir+'/data/community-public.json','utf8');f.adapter.result=async()=>{throw Error('remote failure');};await assert.rejects(reconcile({adapter:f.adapter,directory:dir,finalize:true,commitSHA:sha}),/EXPORT_FAILED/);f.adapter.result=async(...args)=>f.results.push(args);assert.equal((await reconcile({adapter:f.adapter,directory:dir})).changed,false);await reconcile({adapter:f.adapter,directory:dir,finalize:true,commitSHA:sha});assert.equal(await readFile(dir+'/data/community-public.json','utf8'),expected);
 f.rows[0].revision_id=ids.pending;await assert.rejects(reconcile({adapter:f.adapter,directory:dir,finalize:true,commitSHA:sha}),/FINALIZE_FAILED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('search/text/schema/author/routing and trusted legacy catalogue remain source separated',async()=>{
 const f=fixture(),{snapshot}=await desiredSnapshot(f.rows,f.adapter),posts=publicData.posts(snapshot),moments=publicData.moments(snapshot),index=search.createIndex(posts,moments,{});
 for(const term of ['社区文章','短摘要','window.compromised','测试标签','测试分类'])assert.ok(search.search(index,term).some(h=>h.slug==='community-first-article'),term);
 assert.equal(publicData.description(snapshot.items[0]).length>=25,true);assert.equal(posts[0].featured,false);assert.equal(posts[0].readingTime,2);assert.equal(posts[0].author_profile.username,'member_user');assert.equal(publicData.target(snapshot.items[1]),'moments.html#community-'+ids.moment);assert.equal(publicData.target(snapshot.items[2]),'gallery.html?community='+ids.album);
 const legacy=await legacyCatalogue();assert.ok(legacy.some(t=>t.target_id==='post-austria-history'));assert.ok(legacy.every(t=>!Object.hasOwn(t,'author_id')));assert.ok(legacy.every(t=>!t.target_path.startsWith('profile')));
 const dir=await fixtureSite();try{await writeFile(dir+'/js/albums.js','window.SITE_ALBUMS = '+JSON.stringify([{id:'public-album',title:'Public',created:'2026-10-07',visibility:'public'},{id:'private-album',title:'Private',created:'2026-10-07',visibility:'private'}])+';');const catalogue=await legacyCatalogue(dir);assert.ok(catalogue.some(t=>t.target_id==='public-album'));assert.ok(!catalogue.some(t=>t.target_id==='private-album'));await writeFile(dir+'/js/albums.js','window.SITE_ALBUMS = [];');assert.ok(!(await legacyCatalogue(dir)).some(t=>t.target_id==='public-album'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('injected HTTP credentials stay server-side, errors never echo remote bodies, CLI refuses feature/PR/local',async()=>{
 const calls=[],key=['fixture','sensitive','key'].join('-'),adapter=serviceAdapter({url:'https://fixture.supabase.invalid',key,fetchImpl:async(url,opts)=>{calls.push([url.href,opts]);return {ok:false,json:async()=>({secret:key}),text:async()=>key};}});
 await assert.rejects(adapter.export(),e=>e.message==='EXPORT_FAILED'&&!e.message.includes(key));assert.equal(calls[0][1].headers.Authorization,'Bearer '+key);assert.equal(calls[0][1].redirect,'error');
 assert.throws(()=>execFileSync(process.execPath,['scripts/sync-community-public.mjs'],{cwd:root,env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/feature/community-v2',GITHUB_EVENT_NAME:'workflow_dispatch',SUPABASE_SERVICE_ROLE_KEY:key},stdio:'pipe'}),e=>!e.stderr.toString().includes(key)&&e.status===1);
 const workflow=await readFile(new URL('../.github/workflows/sync-community-public.yml',import.meta.url),'utf8');assert.match(workflow,/refs\/heads\/main/);assert.match(workflow,/\*\/5 \* \* \* \*/);assert.ok(workflow.indexOf('git push origin HEAD:main')<workflow.indexOf('node scripts/sync-community-public.mjs --finalize'));assert.doesNotMatch(workflow,/PAT|pull_request/);
});
test('service HTTP adapter stays in exact bucket boundaries, cleans only generated public prefix and never persists credentials',async()=>{
 const f=fixture(),dir=await fixtureSite(),requests=[],key='fixture-sensitive-runtime';
 const response=(value,bytes=null)=>({ok:true,json:async()=>value,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 const adapter=serviceAdapter({url:'https://fixture.supabase.invalid',key,fetchImpl:async(url,options)=>{
  assert.equal(options.headers.apikey,key);assert.equal(options.headers.Authorization,'Bearer '+key);const u=new URL(url);requests.push([u.pathname,options.method||'GET']);const args=options.headers['Content-Type']==='application/json'?JSON.parse(options.body):null;
  if(u.pathname.endsWith('/community_publication_export'))return response(f.rows);
  if(u.pathname.endsWith('/community_sync_legacy_targets'))return response(null);
  if(u.pathname.endsWith('/community_publication_result')){f.results.push(args);return response(true);}
  if(u.pathname.startsWith('/storage/v1/object/community-assets/')){const a=f.files.find(a=>a.object_path===u.pathname.split('/community-assets/')[1]);assert.ok(a);return response(null,a.bytes);}
  if(u.pathname.startsWith('/storage/v1/object/published-media/')){const name=u.pathname.split('/published-media/')[1];assert.equal(options.method,'POST');assert.equal(options.headers['x-upsert'],'true');f.objects.set(name,options.body);return response(null);}
  if(u.pathname==='/storage/v1/object/list/published-media'){const prefix=args.prefix+'/';const names=[...f.objects.keys()].filter(n=>n.startsWith(prefix)),children=new Map();for(const name of names){const rest=name.slice(prefix.length),part=rest.split('/')[0];children.set(part,{name:part,id:rest.includes('/')?null:'object'});}return response([...children.values()].slice(args.offset,args.offset+args.limit));}
  if(u.pathname==='/storage/v1/object/published-media'){assert.equal(options.method,'DELETE');args.prefixes.forEach(p=>{assert.ok(p.startsWith('community/'));f.objects.delete(p);});return response(null);}
  throw Error('Unexpected HTTP boundary');
 }});
 try{await reconcile({adapter,directory:dir});await reconcile({adapter,directory:dir,verify:true});assert.equal(f.results.some(r=>r.p_status==='published'),false);await reconcile({adapter,directory:dir,finalize:true,commitSHA:sha});assert.equal(f.objects.size,10);assert.ok(f.results.some(r=>r.p_status==='published'));assert.doesNotMatch(await readFile(dir+'/data/community-public.json','utf8'),new RegExp(key));
 f.rows=[];await reconcile({adapter,directory:dir});await reconcile({adapter,directory:dir,finalize:true,commitSHA:sha});assert.equal(f.objects.size,0);assert.ok(requests.filter(r=>r[1]==='DELETE').every(r=>r[0]==='/storage/v1/object/published-media'));assert.ok(requests.every(r=>!r[0].includes('dm-media')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
