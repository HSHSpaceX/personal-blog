// Operator tool: inspect locally; writes require a reviewed main Actions run.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import legacy from '../js/legacy-content.js';
import schema from '../js/community-schema.js';
import {validateMedia} from './sync-community-public.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=value=>createHash('sha256').update(value).digest('hex');
function Legacy_Mime(bytes,file){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
 if(bytes.subarray(4,8).toString()==='ftyp')return 'video/mp4';
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(file.endsWith('.txt'))return 'text/plain';throw Error('Unsupported legacy media bytes');
}
export async function Legacy_Plan(directory=root){
 const c={window:{}};for(const name of ['posts','moments','albums'])vm.runInNewContext(await readFile(path.join(directory,'js',name+'.js'),'utf8'),c,{timeout:1000});
 const entries=[],identifiers=new Set();
 for(const [type,rows] of [['article',c.window.BLOG_POSTS||[]],['moment',c.window.BLOG_MOMENTS||[]],['album',c.window.SITE_ALBUMS||[]]])for(const row of rows){
  if(row.visibility==='private')continue;
  const id=type==='article'?row.slug:row.id,key=type+':'+id;
  if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id)||identifiers.has(key))throw Error('Legacy identifier collision');identifiers.add(key);
  const paths=new Set();if(type==='article')for(const match of String(row.content||'').matchAll(/(?:src|href)=["'](\/?assets\/[^"']+)["']/g))paths.add(match[1].replace(/^\//,''));
  if(row.cover&&row.cover.startsWith('assets/'))paths.add(row.cover);
  if(type==='moment'){if(row.image)paths.add(row.image);for(const m of row.media||[])paths.add(m.src);}
  if(type==='album')for(const p of row.photos||[])paths.add(p.src);
  const files=[];for(const file of paths){if(typeof file!=='string'||!file.startsWith('assets/')||file.includes('\\')||file.split('/').some(p=>p==='..'||p==='.')||/[?#]/.test(file))throw Error('Legacy media path requires review');
   const full=path.resolve(directory,file);if(!full.startsWith(path.resolve(directory)+path.sep))throw Error('Legacy path escape');const bytes=await readFile(full),mime=Legacy_Mime(bytes,file),declared={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',pdf:'application/pdf',txt:'text/plain'}[path.extname(file).slice(1).toLowerCase()];if(!declared||mime!==declared&&(!mime.startsWith('image/')||!declared.startsWith('image/')))throw Error('Legacy extension/MIME conflict');files.push({path:file,sha256:digest(bytes),size_bytes:bytes.length,mime_type:mime,extension_mismatch:mime!==declared});}
  const published=type==='article'?row.date:type==='album'?row.created:String(row.time).replace(' ','T')+'+08:00';if(isNaN(Date.parse(published)))throw Error('Invalid legacy date');
  entries.push({type,target_id:id,slug:type==='article'?id:'legacy-'+id.toLowerCase().replace(/_/g,'-'),source_sha256:digest(JSON.stringify(row)),published_at:new Date(published).toISOString(),row,files});
 }
 return {version:1,entries};
}
export async function Legacy_Import(plan,{directory=root,owner,DOMParser,adapter}){
 if(!schema.uuid(owner)||plan.version!==1)throw Error('Verified legacy owner required');
 const current=await Legacy_Plan(directory);if(JSON.stringify(current)!==JSON.stringify(plan))throw Error('Legacy plan changed; repeat dry-run and review');
 const names=new Map(),prepared=[];
 // Validate all documents/media before the first external mutation.
 for(const entry of plan.entries){const refs={};for(const f of entry.files){const mime=f.mime_type;if(!schema.mime[mime])throw Error('Unsupported legacy MIME');
   const id=f.sha256.slice(0,8)+'-'+f.sha256.slice(8,12)+'-4'+f.sha256.slice(13,16)+'-8'+f.sha256.slice(17,20)+'-'+f.sha256.slice(20,32),object=owner+'/'+id+'.'+schema.mime[mime];
   const asset={id,owner_id:owner,bucket_id:'community-assets',object_path:object,original_name:f.extension_mismatch?path.basename(f.path,path.extname(f.path))+'.'+schema.mime[mime]:path.basename(f.path),mime_type:mime,size_bytes:f.size_bytes,storage_metadata:{mimetype:mime,size:f.size_bytes}};
   validateMedia(asset,new Uint8Array(await readFile(path.join(directory,f.path))));names.set(f.path,{...asset,file:f});refs[f.path]=id;}
  const row=entry.row;let body;
  if(entry.type==='article'){body={...legacy.convert(row.content,{DOMParser,assets:refs}),category:row.category||'杂谈',summary:row.excerpt||'',tags:row.tags||[]};if(row.cover&&refs[row.cover]){body.cover_asset_id=refs[row.cover];if(!body.asset_ids.includes(body.cover_asset_id))body.asset_ids.push(body.cover_asset_id);}}
  else if(entry.type==='moment')body={text:row.text||'',asset_ids:[...new Set(entry.files.map(f=>refs[f.path]))]};
  else body={description:row.description||'',photos:(row.photos||[]).map(p=>({asset_id:refs[p.src],caption:p.caption||''}))};
  schema.validate(entry.type,row.title||'动态',body);prepared.push({entry,body});
 }
 // Import RPC is idempotent and rejects existing source/slug conflicts before any upload.
 await adapter.preflight(plan.entries);
 const registered=new Map();for(const [name,a] of names){await adapter.upload(a.object_path,new Uint8Array(await readFile(path.join(directory,name))),a.mime_type);registered.set(a.id,await adapter.register(owner,a));}
 const results=[];for(const {entry,body} of prepared){const mapped=JSON.parse(JSON.stringify(body));if(mapped.asset_ids)mapped.asset_ids=mapped.asset_ids.map(id=>registered.get(id));if(mapped.cover_asset_id)mapped.cover_asset_id=registered.get(mapped.cover_asset_id);if(mapped.photos)mapped.photos.forEach(p=>{p.asset_id=registered.get(p.asset_id);});if(mapped.document)mapped.document.blocks.forEach(b=>{if(b.type==='asset')b.asset_id=registered.get(b.asset_id);});results.push(await adapter.import(owner,entry,mapped));}
 return results;
}
export function Legacy_ServiceAdapter(url,key,fetchImpl=fetch){
 const origin=new URL(url);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw Error('Invalid service origin');
 async function Legacy_Request(route,options={}){const r=await fetchImpl(new URL(route,origin),{...options,redirect:'error',signal:AbortSignal.timeout(120000),headers:{apikey:key,Authorization:'Bearer '+key,...options.headers}});if(!r.ok)throw Error('Legacy server operation failed; inspect protected server logs');return r;}
 const rpc=async(name,args)=>(await Legacy_Request('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)})).json();
 return {preflight:async entries=>{const items=await (await Legacy_Request('/rest/v1/content_items?select=id,content_type,slug')).json(),maps=await (await Legacy_Request('/rest/v1/community_legacy_mappings?select=item_id,target_type,target_id,source_sha256')).json();for(const e of entries){const m=maps.find(m=>m.target_type===(e.type==='article'?'post':e.type)&&m.target_id===e.target_id);if(m&&m.source_sha256!==e.source_sha256||items.some(i=>i.content_type===e.type&&i.slug===e.slug&&(!m||m.item_id!==i.id)))throw Error('Legacy conflict; no files imported');}},
 upload:async(object,bytes,mime)=>{const route='/storage/v1/object/community-assets/'+object.split('/').map(encodeURIComponent).join('/');const existing=await fetchImpl(new URL(route,origin),{redirect:'error',signal:AbortSignal.timeout(120000),headers:{apikey:key,Authorization:'Bearer '+key}});if(existing.ok){if(digest(new Uint8Array(await existing.arrayBuffer()))!==digest(bytes))throw Error('Existing legacy object differs; never overwrite');return;}if(![400,404].includes(existing.status))throw Error('Legacy object lookup failed');await Legacy_Request(route,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes});},
 register:(owner,a)=>rpc('community_register_legacy_asset',{p_owner:owner,p_path:a.object_path,p_name:a.original_name,p_mime:a.mime_type,p_size:a.size_bytes}),
 import:(owner,e,body)=>rpc('community_import_legacy',{p_owner:owner,p_type:e.type,p_slug:e.slug,p_target_id:e.target_id,p_source_sha256:e.source_sha256,p_title:e.row.title||'动态',p_body:body,p_published_at:e.published_at,p_featured:!!e.row.featured})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.includes('--apply')){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Apply requires a reviewed main workflow_dispatch');
  const planFile=process.argv[process.argv.indexOf('--apply')+1],plan=JSON.parse(await readFile(planFile,'utf8'));if(digest(JSON.stringify(plan))!==process.env.LEGACY_PLAN_SHA256)throw Error('Reviewed plan digest mismatch');
  const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('');try{await Legacy_Import(plan,{owner:process.env.LEGACY_OWNER_ID,DOMParser:dom.window.DOMParser,adapter:Legacy_ServiceAdapter(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)});}finally{dom.window.close();}console.log('Audited import completed; run the publication workflow and verify actual Pages deployment.');
 }else{const output=process.argv[process.argv.indexOf('--output')+1];if(!process.argv.includes('--output')||!output)throw Error('Use --output <reviewed-plan.json>');const plan=await Legacy_Plan();await writeFile(output,JSON.stringify(plan,null,2)+'\n');console.log('Dry-run only: '+plan.entries.length+' public entries; digest '+digest(JSON.stringify(plan))+'. No network or database writes.');}}
 catch(error){console.error(error.message);process.exitCode=1;}
}
