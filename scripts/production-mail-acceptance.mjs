// Manual operator acceptance. Recipient is injected only through an Actions Secret.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUPABASE_PUBLISHABLE_KEY} from '../site.config.mjs';
const origin='https://hscqeswnscnvkdthhlfp.supabase.co';
const redirect='https://hsh-personal-blog.pages.dev/login.html?reset=1';
export const MailAcceptanceConfigResult=Object.freeze({Ready:'READY',Rejected:'REJECTED'});
export function MailAcceptance_ValidateConfig(env){return env.GITHUB_ACTIONS==='true'&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.MAIL_APPROVAL==='invite-recovery-cleanup-20261031'&&env.MAIL_SOURCE_SHA===env.GITHUB_SHA&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&env.SUPABASE_URL===origin&&!!env.SUPABASE_SERVICE_ROLE_KEY?.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.PRODUCTION_MAIL_TEST_EMAIL||'')&&/^mail-20261031-[0-9a-f-]{36}$/.test(env.MAIL_TEST_TAG||'')&&['invite','recover','inspect','cleanup'].includes(env.MAIL_ACTION)?MailAcceptanceConfigResult.Ready:MailAcceptanceConfigResult.Rejected;}
export function MailAcceptance_IsOwned(user,email,tag){return user?.email?.toLowerCase()===email.toLowerCase()&&user.user_metadata?.release_mail_test===tag&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(user.id||'');}
export async function MailAcceptance_Run(env,fetchImpl=fetch){
 if(MailAcceptance_ValidateConfig(env)!==MailAcceptanceConfigResult.Ready)throw Error('Mail acceptance configuration rejected');
 const email=env.PRODUCTION_MAIL_TEST_EMAIL,key=env.SUPABASE_SERVICE_ROLE_KEY,tag=env.MAIL_TEST_TAG,action=env.MAIL_ACTION;
 const report={action,checks:[],mail_delivery:'NOT_VERIFIED',cleanup:'NOT_REQUESTED'};
 async function request(route,{method='GET',body,publicRequest=false}={}){const r=await fetchImpl(origin+'/auth/v1/'+route,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{apikey:publicRequest?SUPABASE_PUBLISHABLE_KEY:key,...publicRequest?{}:{Authorization:'Bearer '+key},...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});let value=null;try{value=await r.json();}catch{}if(!r.ok){const code=typeof value?.code==='string'&&/^[a-z_]{1,80}$/.test(value.code)?value.code:'redacted_error';report.checks.push({operation:route.split('?')[0].replace(/[0-9a-f-]{36}/g,'[temporary-user]'),http:r.status,error_code:code});throw Error('Mail operation rejected');}return {http:r.status,value};}
 async function find(){for(let page=1;page<=100;page++){const {value}=await request('admin/users?page='+page+'&per_page=100');if(!Array.isArray(value?.users))throw Error('Invalid user lookup');const u=value.users.find(u=>u.email?.toLowerCase()===email.toLowerCase());if(u)return u;if(value.users.length<100)return null;}throw Error('User lookup incomplete');}
 let failed=false;
 try{let user=await find();
  if(user&&!MailAcceptance_IsOwned(user,email,tag))throw Error('Existing unrelated account; no writes performed');
  report.checks.push({operation:'recipient_scope',pass:true,temporary_account_exists:!!user});
  if(action==='invite'){
   if(user){report.checks.push({operation:'invite',status:'SKIP_ALREADY_INVITED'});}
   else{const result=await request('invite?redirect_to='+encodeURIComponent(redirect),{method:'POST',body:{email,data:{display_name:'临时邮件验收',release_mail_test:tag}}});user=result.value?.user??result.value;if(!MailAcceptance_IsOwned(user,email,tag))throw Error('Invite account provenance mismatch');report.checks.push({operation:'invite',http:result.http,status:'ACCEPTED_BY_AUTH',invited_at_present:!!user.invited_at});}
  }else if(action==='recover'){
   if(!user)throw Error('Invite account missing');
   if(user.recovery_sent_at){report.checks.push({operation:'recover',status:'SKIP_ALREADY_REQUESTED'});}
   else{const result=await request('recover?redirect_to='+encodeURIComponent(redirect),{method:'POST',publicRequest:true,body:{email}});report.checks.push({operation:'recover',http:result.http,status:'ACCEPTED_BY_AUTH'});}
  }else if(action==='cleanup'){
   if(user){await request('admin/users/'+user.id,{method:'DELETE',body:{should_soft_delete:false}});if(await find())throw Error('Temporary account remains');}report.cleanup='PASS';
  }else{report.checks.push({operation:'user_link_state',confirmed:!!user?.email_confirmed_at,invite_sent:!!user?.invited_at,recovery_sent:!!user?.recovery_sent_at,has_signed_in:!!user?.last_sign_in_at});}
 }catch{failed=true;report.failure='Mail acceptance failed; inspect redacted HTTP code and scoped account state';}
 const dir=path.join(env.RUNNER_TEMP,'personal-blog-mail-acceptance');await mkdir(dir,{recursive:true,mode:0o700});await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));if(failed)throw Error('Mail acceptance failed');return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))MailAcceptance_Run(process.env).catch(()=>{console.error('Mail acceptance failed; no recipient, token or response body printed.');process.exitCode=1;});
