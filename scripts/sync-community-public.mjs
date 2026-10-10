// Service-side publisher. CLI production access is main Actions only.
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url), publicData=require('../js/community-public.js'),schema=require('../js/community-schema.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const extensions=schema.mime;
export class PublicationError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new PublicationError(code);};
const stableJSON=value=>JSON.stringify(value,null,2)+'\n';
export function validateMedia(asset,bytes=null){
 const suffix=extensions[asset.mime_type],meta=asset.storage_metadata||{};
 if(!UUID.test(asset.id)||!UUID.test(asset.owner_id)||asset.bucket_id!=='community-assets'||!suffix||
 !new RegExp('^'+asset.owner_id+'/[0-9a-f-]{36}\\.'+(suffix==='jpg'?'jpe?g':suffix)+'$','i').test(asset.object_path)||
 !Number.isInteger(Number(asset.size_bytes))||Number(asset.size_bytes)<1||Number(asset.size_bytes)>20971520||
 Number(meta.size)!==Number(asset.size_bytes)||meta.mimetype!==asset.mime_type||(bytes!==null&&bytes.length!==Number(asset.size_bytes))||
 typeof asset.original_name!=='string'||asset.original_name.length>255||/[\\/\x00-\x1f]/.test(asset.original_name)||
 !new RegExp('^[^.]+\\.'+(suffix==='jpg'?'jpe?g':suffix)+'$','i').test(asset.original_name))fail('INVALID_MEDIA');
 if(bytes===null)return suffix;
 const b=Buffer.from(bytes),prefix=b.subarray(0,16),mime=asset.mime_type;
 const good=mime==='image/jpeg'?b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255:
 mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
 mime==='image/webp'?b.length>=12&&prefix.subarray(0,4).toString()==='RIFF'&&prefix.subarray(8,12).toString()==='WEBP':
 mime==='application/pdf'?prefix.subarray(0,5).toString()==='%PDF-':
 mime==='video/mp4'?b.length>=12&&prefix.subarray(4,8).toString()==='ftyp'&&['isom','iso2','mp41','mp42','avc1','M4V '].includes(prefix.subarray(8,12).toString()):
 mime==='text/plain'?b.length<=20971520&&!b.includes(0)&&!/[<>]/.test(new TextDecoder('utf-8',{fatal:true}).decode(b)):false;
 if(!good)fail('INVALID_MEDIA');return suffix;
}
export async function desiredSnapshot(rows,adapter){
 const items=[],media=[];if(!Array.isArray(rows))fail('INVALID_SNAPSHOT');
 for(const row of rows){
  let refs;try{refs=schema.validate(row.content_type,row.title,row.body);}catch{fail('INVALID_SNAPSHOT');}
  if(!Array.isArray(row.assets)||row.assets.length!==refs.length||row.assets.some(a=>!refs.includes(a.id)))fail('INVALID_MEDIA');
  const item={id:row.id,revision_id:row.revision_id,content_type:row.content_type,slug:row.slug,title:row.title,body:row.body,published_at:row.published_at,
   author:{username:row.author?.username,display_name:row.author?.display_name||'',avatar_url:row.author?.avatar_url||''},assets:[]};
  // Avatar URLs must be durable HTTPS/local profile values, never a signed URL.
  if(/[?&](token|signature)=/i.test(item.author.avatar_url)||/\/object\/sign\/|\/(community-assets|dm-media)\//.test(item.author.avatar_url))item.author.avatar_url='';
  for(const a of [...row.assets].sort((a,b)=>a.id.localeCompare(b.id))){
   validateMedia(a);
   const bytes=await adapter.download(a.object_path),extension=validateMedia(a,bytes);
   const name='community/'+row.id+'/'+row.revision_id+'/'+a.id+'.'+extension;
   media.push({name,bytes,mime:a.mime_type});item.assets.push({id:a.id,mime_type:a.mime_type,name:a.original_name,url:adapter.publicURL(name)});
  }items.push(item);
 }
 const snapshot={version:1,items:items.sort((a,b)=>a.id.localeCompare(b.id))};
 try{publicData.validate(snapshot);if(/\/object\/sign\/|[?&](token|signature)=/i.test(JSON.stringify(snapshot)))fail('INVALID_SNAPSHOT');}catch{fail('INVALID_SNAPSHOT');}return {snapshot,media};
}
export async function legacyCatalogue(directory=root){
 const context={window:{}};for(const file of ['posts','moments','albums'])vm.runInNewContext(await readFile(path.join(directory,'js/'+file+'.js'),'utf8'),context,{timeout:1000});
 const plain=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),out=[];
 const put=(type,id,title,text,date)=>{if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id)||isNaN(Date.parse(date)))fail('INVALID_SNAPSHOT');out.push({target_type:type,target_id:id,title:plain(title).slice(0,160),excerpt:plain(text).slice(0,500),published_at:new Date(date).toISOString(),target_path:type==='post'?(id==='about'?'about.html#commentsSection':'posts/'+id+'.html'):type==='moment'?'moments.html#moment-'+id:'gallery.html?album='+id});};
 for(const p of context.window.BLOG_POSTS||[])put('post',p.slug,p.title,p.excerpt||p.content,p.date);
 for(const m of context.window.BLOG_MOMENTS||[])put('moment',m.id,'动态',m.text,String(m.time).replace(' ','T')+'+08:00');
 for(const a of context.window.SITE_ALBUMS||[])if(a.visibility!=='private')put('album',a.id,a.title,a.description,a.created);
 put('post','about','关于','关于拾光手记','2026-09-30');return out.sort((a,b)=>(a.target_type+a.target_id).localeCompare(b.target_type+b.target_id));
}
export async function reconcile({adapter,directory=root,finalize=false,verify=false,commitSHA=null}){
 let rows=[];try{
  rows=await adapter.export();
  if(finalize||verify){
   const saved=publicData.validate(JSON.parse(await readFile(path.join(directory,'data/community-public.json'),'utf8')));
   const current=new Map(rows.map(r=>[r.id,r.revision_id]));
   if(saved.items.length!==rows.length||saved.items.some(i=>current.get(i.id)!==i.revision_id))fail('FINALIZE_FAILED');
   for(const i of saved.items){const row=rows.find(r=>r.id===i.id);if(JSON.stringify(i.body)!==JSON.stringify(row.body)||i.title!==row.title||i.slug!==row.slug||i.assets.length!==row.assets.length||i.assets.some(a=>!row.assets.some(r=>r.id===a.id&&r.mime_type===a.mime_type&&r.original_name===a.name)))fail('FINALIZE_FAILED');}
   if(verify)return {changed:false,snapshot:saved};
   // Cleanup AFTER Git push; never remove private originals or dm-media.
   const desired=new Set(saved.items.flatMap(i=>i.assets.map(a=>new URL(a.url).pathname.split('/published-media/')[1])));
   for(const name of await adapter.listPublic())if(name.startsWith('community/')&&!desired.has(name))await adapter.removePublic(name);
   for(const i of saved.items)if(await adapter.result(i.id,i.revision_id,'published',commitSHA,null)===false)fail('FINALIZE_FAILED');
   return {changed:false,snapshot:saved};
  }
  const {snapshot,media}=await desiredSnapshot(rows,adapter),legacy=await legacyCatalogue(directory);
  // Fail collision before any upload or tracked mutation.
  const context={window:{}};vm.runInNewContext(await readFile(path.join(directory,'js/posts.js'),'utf8'),context,{timeout:1000});
  const slugs=new Set((context.window.BLOG_POSTS||[]).map(p=>p.slug));if(snapshot.items.some(i=>i.content_type==='article'&&slugs.has(i.slug)))fail('INVALID_SNAPSHOT');
  await adapter.legacy(legacy);
  for(const i of snapshot.items)await adapter.result(i.id,i.revision_id,'pending',null,null);
  for(const m of media)await adapter.uploadPublic(m.name,m.bytes,m.mime);
  const dest=path.join(directory,'data/community-public.json'),text=stableJSON(snapshot);
  let previous='';try{previous=await readFile(dest,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous!==text){await writeFile(dest+'.tmp',text);await rename(dest+'.tmp',dest);}
  return {changed:previous!==text,snapshot};
 }catch(error){const code=error instanceof PublicationError?error.code:'EXPORT_FAILED';for(const r of rows){try{await adapter.result(r.id,r.revision_id,'failed',null,code);}catch{ /* retry next schedule */ }}throw new PublicationError(code);}
}
export function serviceAdapter({url,key,fetchImpl=fetch}){
 const origin=new URL(url);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('EXPORT_FAILED');
 async function request(route,options={}){try{const response=await fetchImpl(new URL(route,origin),{...options,redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:key,Authorization:'Bearer '+key,...options.headers}});if(!response.ok)fail(route.startsWith('/storage/')?'STORAGE_FAILED':'EXPORT_FAILED');return response;}catch(e){if(e instanceof PublicationError)throw e;fail('EXPORT_FAILED');}}
 async function rpc(name,body={}){return (await request('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();}
 const segment=p=>p.split('/').map(encodeURIComponent).join('/');
 return {export:()=>rpc('community_publication_export'),legacy:p=>rpc('community_sync_legacy_targets',{p_targets:p}),
 result:(id,rev,status,sha,error)=>rpc('community_publication_result',{p_item_id:id,p_revision_id:rev,p_status:status,p_commit_sha:sha,p_error:error}),
 download:async p=>new Uint8Array(await (await request('/storage/v1/object/community-assets/'+segment(p))).arrayBuffer()),
 publicURL:p=>new URL('/storage/v1/object/public/published-media/'+segment(p),origin).href,
 uploadPublic:async(p,b,mime)=>{await request('/storage/v1/object/published-media/'+segment(p),{method:'POST',headers:{'Content-Type':mime,'x-upsert':'true'},body:b});},
 listPublic:async()=>{const all=[];async function walk(prefix){for(let offset=0;;offset+=100){const page=await (await request('/storage/v1/object/list/published-media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}})})).json();for(const o of page){const name=(prefix?prefix+'/':'')+o.name;if(!o.id)await walk(name);else all.push(name);}if(page.length<100)break;}}await walk('community');return all;},
 removePublic:async p=>{if(!/^community\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|pdf|txt)$/.test(p))fail('STORAGE_FAILED');await request('/storage/v1/object/published-media',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[p]})});}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 // Never consume production credentials from feature/PR/local execution.
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||!['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)){console.error('Publisher requires main schedule/workflow_dispatch. Fixtures use injected adapters.');process.exitCode=1;}
 else try{if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)fail('EXPORT_FAILED');const finalize=process.argv.includes('--finalize'),verify=process.argv.includes('--verify');await reconcile({adapter:serviceAdapter({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}),finalize,verify,commitSHA:finalize?execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim():null});console.log(finalize?'Publication finalized.':'Public snapshot reconciled.');}catch(e){console.error('Publication failed:',e instanceof PublicationError?e.code:'EXPORT_FAILED');process.exitCode=1;}
}
