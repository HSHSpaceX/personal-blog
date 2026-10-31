// Explicitly authorized, manual-only hosted acceptance. Never uses existing users.
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUPABASE_PUBLISHABLE_KEY} from '../site.config.mjs';
export const AcceptanceConfigResult=Object.freeze({Ready:'READY',Rejected:'REJECTED'});
const origin='https://hscqeswnscnvkdthhlfp.supabase.co',approval='temporary-accounts-storage-20261031';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function Acceptance_ValidateConfig(env){return env.GITHUB_ACTIONS==='true'&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.ACCEPTANCE_APPROVAL===approval&&env.ACCEPTANCE_SOURCE_SHA===env.GITHUB_SHA&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&env.SUPABASE_URL===origin&&!!env.SUPABASE_SERVICE_ROLE_KEY?.trim()?AcceptanceConfigResult.Ready:AcceptanceConfigResult.Rejected;}
export function Acceptance_AssertOwnedFile(file,ids){if(!['avatars','dm-media','community-assets'].includes(file.bucket)||!ids.includes(file.owner)||!uuid.test(file.owner)||!new RegExp('^'+file.owner+'/[0-9a-f-]{36}\\.(png|txt|html)$').test(file.name))throw Error('Cleanup scope rejected');}
export async function Acceptance_Run(env,{cleanupOnly=false}={}){
 if(Acceptance_ValidateConfig(env)!==AcceptanceConfigResult.Ready)throw Error('Manual production acceptance authorization/configuration mismatch');
 const dir=path.join(env.RUNNER_TEMP,'personal-blog-http-acceptance');await mkdir(dir,{recursive:true,mode:0o700});
 const journalFile=path.join(dir,'journal.json'),reportFile=path.join(dir,cleanupOnly?'cleanup-report.json':'report.json');
 const key=env.SUPABASE_SERVICE_ROLE_KEY,checks=[],sessions=new Map();let journal;
 try{journal=JSON.parse(await readFile(journalFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;journal={tag:'release-'+env.GITHUB_RUN_ID+'-'+randomUUID(),accounts:[],files:[]};}
 const persist=()=>writeFile(journalFile,JSON.stringify(journal,null,2),{mode:0o600});await persist();
 const check=(name,pass)=>{checks.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error('Acceptance failed: '+name);};
 const enc=p=>p.split('/').map(encodeURIComponent).join('/');
 async function request(route,{token=key,method='GET',json,bytes,headers={}}={}){
  if(!route.startsWith('/auth/v1/')&&!route.startsWith('/rest/v1/')&&!route.startsWith('/storage/v1/'))throw Error('Request scope rejected');
  return fetch(origin+route,{method,redirect:'error',signal:AbortSignal.timeout(90000),headers:{apikey:token===key?key:SUPABASE_PUBLISHABLE_KEY,...token===SUPABASE_PUBLISHABLE_KEY?{}:{Authorization:'Bearer '+token},...json!==undefined?{'Content-Type':'application/json'}:{},...headers},body:json!==undefined?JSON.stringify(json):bytes});
 }
 async function jsonRequest(route,options){const r=await request(route,options);if(!r.ok)throw Error('Acceptance HTTP failure '+r.status+' on '+route.split('?')[0].replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g,'[test-id]'));return r.status===204?null:r.json();}
 async function addFile(owner,bucket,suffix='png'){const file={owner,bucket,name:owner+'/'+randomUUID()+'.'+suffix};Acceptance_AssertOwnedFile(file,journal.accounts);journal.files.push(file);await persist();return file;}
 async function upload(file,token,bytes,mime){return request('/storage/v1/object/'+file.bucket+'/'+enc(file.name),{method:'POST',token,bytes,headers:{'Content-Type':mime,'x-upsert':'false'}});}
 async function clean(){
  // Recover a response-lost create using only this random run marker, never emails.
  const listed=await jsonRequest('/auth/v1/admin/users?page=1&per_page=1000');
  for(const u of listed.users||[])if(u.user_metadata?.release_smoke_id===journal.tag&&!journal.accounts.includes(u.id))journal.accounts.push(u.id);
  await persist();const verified=[];
  for(const id of journal.accounts){if(!uuid.test(id))throw Error('Invalid cleanup account');const r=await request('/auth/v1/admin/users/'+id);if(r.status===404)continue;if(!r.ok)throw Error('Cannot verify cleanup account');const u=await r.json();if(u.user_metadata?.release_smoke_id!==journal.tag)throw Error('Account provenance mismatch');verified.push(id);}
  for(const f of journal.files){Acceptance_AssertOwnedFile(f,journal.accounts);const r=await request('/storage/v1/object/'+f.bucket,{method:'DELETE',json:{prefixes:[f.name]}});if(!r.ok)throw Error('Test object cleanup failed');const list=await jsonRequest('/storage/v1/object/list/'+f.bucket,{method:'POST',json:{prefix:f.owner,limit:100,offset:0}});if(list.some(x=>x.name===f.name.split('/')[1]))throw Error('Test object remains');}
  for(const id of verified){const r=await request('/auth/v1/admin/users/'+id,{method:'DELETE',json:{should_soft_delete:false}});if(!r.ok)throw Error('Test account cleanup failed');}
  for(const id of verified){const r=await request('/auth/v1/admin/users/'+id);if(r.status!==404)throw Error('Test account still exists');}
  journal.cleaned=true;await persist();return {accounts:verified.length,files:journal.files.length,status:'PASS'};
 }
 let failure=null,cleanup=null;
 try{
  if(!cleanupOnly){
   const settings=await jsonRequest('/auth/v1/settings',{token:SUPABASE_PUBLISHABLE_KEY});check('public_signup_disabled',settings.disable_signup===true);
   for(const role of ['user','admin']){
    const email=journal.tag+'-'+role+'@example.invalid',password=randomBytes(32).toString('base64url');
    const u=await jsonRequest('/auth/v1/admin/users',{method:'POST',json:{email,password,email_confirm:true,user_metadata:{display_name:'临时发布验收 '+role,release_smoke_id:journal.tag}}});
    if(!uuid.test(u.id))throw Error('Invalid new account response');journal.accounts.push(u.id);await persist();
    if(role==='admin'){const rows=await jsonRequest('/rest/v1/user_roles?user_id=eq.'+u.id,{method:'PATCH',json:{role:'admin'},headers:{Prefer:'return=representation'}});check('temporary_admin_assignment',rows.length===1&&rows[0].role==='admin');}
    const auth=await jsonRequest('/auth/v1/token?grant_type=password',{method:'POST',token:SUPABASE_PUBLISHABLE_KEY,json:{email,password}});check(role+'_real_password_login',auth.user?.id===u.id&&!!auth.access_token);sessions.set(role,{id:u.id,token:auth.access_token,refresh:auth.refresh_token});
   }
   const user=sessions.get('user'),admin=sessions.get('admin');
   for(const [role,s] of sessions){const value=await jsonRequest('/rest/v1/rpc/is_admin',{method:'POST',token:s.token,json:{}});check(role+'_role_enforced',value===(role==='admin'));}
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1kAAAAASUVORK5CYII=','base64');
   for(const [role,s] of sessions){const file=await addFile(s.id,'avatars');check(role+'_avatar_upload',(await upload(file,s.token,png,'image/png')).ok);const url=origin+'/storage/v1/object/public/avatars/'+file.name;
    const updated=await jsonRequest('/rest/v1/profiles?id=eq.'+s.id,{method:'PATCH',token:s.token,json:{avatar_url:url},headers:{Prefer:'return=representation'}});check(role+'_own_profile_update',updated.length===1&&updated[0].avatar_url===url);
    const profiles=await jsonRequest('/rest/v1/profiles?select=avatar_url&id=eq.'+s.id,{token:s.token});check(role+'_avatar_persisted_after_reload',profiles.length===1&&profiles[0].avatar_url===url);
    const publicImage=await request('/storage/v1/object/public/avatars/'+file.name,{token:SUPABASE_PUBLISHABLE_KEY});check(role+'_public_avatar_read',publicImage.ok&&Buffer.from(await publicImage.arrayBuffer()).equals(png));
   }
   const cross=await jsonRequest('/rest/v1/profiles?id=eq.'+admin.id,{method:'PATCH',token:user.token,json:{display_name:'not_allowed'},headers:{Prefer:'return=representation'}});check('cross_account_profile_update_denied',Array.isArray(cross)&&cross.length===0);
   const reverse=await jsonRequest('/rest/v1/profiles?id=eq.'+user.id,{method:'PATCH',token:admin.token,json:{display_name:'not_allowed'},headers:{Prefer:'return=representation'}});check('admin_cannot_edit_other_profile',Array.isArray(reverse)&&reverse.length===0);
   const otherAvatar=journal.files.find(f=>f.owner===admin.id&&f.bucket==='avatars');const crossAvatar=await request('/storage/v1/object/avatars/'+otherAvatar.name,{method:'POST',token:user.token,bytes:png,headers:{'Content-Type':'image/png','x-upsert':'true'}});check('cross_account_avatar_overwrite_denied',!crossAvatar.ok&&[400,401,403].includes(crossAvatar.status));
   for(const bucket of ['dm-media','community-assets']){
    const file=await addFile(user.id,bucket);check(bucket+'_owner_upload',(await upload(file,user.token,png,'image/png')).ok);
    const own=await request('/storage/v1/object/authenticated/'+bucket+'/'+file.name,{token:user.token});check(bucket+'_owner_read',own.ok&&Buffer.from(await own.arrayBuffer()).equals(png));
    const denied=await request('/storage/v1/object/authenticated/'+bucket+'/'+file.name,{token:admin.token});check(bucket+'_admin_cannot_read_other_private_file',!denied.ok&&[400,401,403,404].includes(denied.status));
    const deniedSign=await request('/storage/v1/object/sign/'+bucket+'/'+file.name,{method:'POST',token:admin.token,json:{expiresIn:60}});check(bucket+'_cross_account_sign_denied',!deniedSign.ok);
    const sign=await jsonRequest('/storage/v1/object/sign/'+bucket+'/'+file.name,{method:'POST',token:user.token,json:{expiresIn:60}});const signed=new URL(sign.signedURL,origin+'/storage/v1');if(signed.origin!==origin)throw Error('Signed URL origin mismatch');const signedPath=signed.pathname.startsWith('/object/')?'/storage/v1'+signed.pathname+signed.search:signed.pathname+signed.search;const download=await request(signedPath,{token:SUPABASE_PUBLISHABLE_KEY});check(bucket+'_owner_signed_download',download.ok&&Buffer.from(await download.arrayBuffer()).equals(png));
    const deniedDelete=await request('/storage/v1/object/'+bucket,{method:'DELETE',token:admin.token,json:{prefixes:[file.name]}});check(bucket+'_cross_delete_request_bounded',deniedDelete.ok||[400,401,403,404].includes(deniedDelete.status));const still=await request('/storage/v1/object/authenticated/'+bucket+'/'+file.name,{token:user.token});check(bucket+'_cross_delete_did_not_remove',still.ok);
    const crossFile=await addFile(admin.id,bucket);check(bucket+'_cross_account_upload_denied',!(await upload(crossFile,user.token,png,'image/png')).ok);
   }
   const bad=await addFile(user.id,'avatars','html');check('avatar_mime_limit',!(await upload(bad,user.token,Buffer.from('<html>test</html>'),'text/html')).ok);
   const oversized=await addFile(user.id,'avatars');check('avatar_2mib_limit',!(await upload(oversized,user.token,Buffer.alloc(2097153,65),'image/png')).ok);
   const tus=await addFile(user.id,'community-assets','txt'),bytes=Buffer.alloc(6*1024*1024+128,65);
   const metadata=Object.entries({bucketName:tus.bucket,objectName:tus.name,contentType:'text/plain',cacheControl:'3600'}).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
   const created=await request('/storage/v1/upload/resumable',{method:'POST',token:user.token,headers:{'Tus-Resumable':'1.0.0','Upload-Length':String(bytes.length),'Upload-Metadata':metadata,'x-upsert':'false'}});check('tus_create',created.status===201);
   const location=new URL(created.headers.get('location'),origin);if(location.origin!==origin||!location.pathname.startsWith('/storage/v1/upload/resumable/'))throw Error('TUS location scope mismatch');
   const first=await request(location.pathname,{method:'PATCH',token:user.token,bytes:bytes.subarray(0,6*1024*1024),headers:{'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream'}});check('tus_first_chunk',first.status===204);
   const head=await request(location.pathname,{method:'HEAD',token:user.token,headers:{'Tus-Resumable':'1.0.0'}});check('tus_resume_offset',head.ok&&Number(head.headers.get('upload-offset'))===6*1024*1024);
   const last=await request(location.pathname,{method:'PATCH',token:user.token,bytes:bytes.subarray(6*1024*1024),headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(6*1024*1024),'Content-Type':'application/offset+octet-stream'}});check('tus_resume_complete',last.status===204);
   const uploaded=await request('/storage/v1/object/authenticated/community-assets/'+tus.name,{token:user.token});const downloaded=Buffer.from(await uploaded.arrayBuffer());check('tus_final_bytes_sha256',uploaded.ok&&createHash('sha256').update(downloaded).digest('hex')===createHash('sha256').update(bytes).digest('hex'));
   const refresh=await jsonRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',token:SUPABASE_PUBLISHABLE_KEY,json:{refresh_token:user.refresh}});check('refresh_session',refresh.user?.id===user.id&&!!refresh.access_token);
   const logout=await request('/auth/v1/logout?scope=global',{method:'POST',token:refresh.access_token});check('logout',logout.ok);
   const revoked=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',token:SUPABASE_PUBLISHABLE_KEY,json:{refresh_token:refresh.refresh_token}});check('logout_refresh_revoked',!revoked.ok);
  }
 }catch(e){failure=e.message.startsWith('Acceptance ')?e.message:'Acceptance operation failed (details withheld)';}
 finally{try{cleanup=await clean();}catch{cleanup={status:'FAIL',action:'Inspect the scoped journal; do not remove unrelated users or objects'};}await writeFile(reportFile,JSON.stringify({tag:journal.tag,checks,failure,cleanup,scope:'Temporary accounts and their own files only; no content publication or emails'},null,2),{mode:0o600});}
 console.log(JSON.stringify({checks:checks.length,passed:checks.filter(x=>x.status==='PASS').length,failure,cleanup}));if(failure||cleanup.status!=='PASS')throw Error('Hosted acceptance or cleanup failed; inspect report artifact');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))Acceptance_Run(process.env,{cleanupOnly:process.argv.includes('--cleanup')}).catch(()=>{console.error('Hosted acceptance failed; inspect redacted report and scoped journal.');process.exitCode=1;});
