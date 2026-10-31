// Read-only Actions diagnostics. Never emit credential values or response bodies.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const PublisherConnectionResult=Object.freeze({Ready:'READY',InvalidConfiguration:'INVALID_CONFIGURATION',ConnectionFailed:'CONNECTION_FAILED'});
const productionURL='https://hscqeswnscnvkdthhlfp.supabase.co';
export async function Publisher_CheckConnection(env,fetchImpl=fetch){
 const checks=[];
 const configured=env.SUPABASE_URL===productionURL&&typeof env.SUPABASE_SERVICE_ROLE_KEY==='string'&&env.SUPABASE_SERVICE_ROLE_KEY.length>0&&env.SUPABASE_SERVICE_ROLE_KEY===env.SUPABASE_SERVICE_ROLE_KEY.trim();
 checks.push({check:'expected_project_and_clean_configuration',pass:configured});
 if(!configured)return {result:PublisherConnectionResult.InvalidConfiguration,checks};
 for(const rpc of ['community_release_preflight','community_publication_export','community_site_settings_export','community_deleted_export']){
  try{
   const r=await fetchImpl(productionURL+'/rest/v1/rpc/'+rpc,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(30000)});
   checks.push({check:rpc,http:r.status,pass:r.ok});
   await r.arrayBuffer();
   if(!r.ok)return {result:PublisherConnectionResult.ConnectionFailed,checks};
  }catch{checks.push({check:rpc,pass:false,transport_error:true});return {result:PublisherConnectionResult.ConnectionFailed,checks};}
 }
 return {result:PublisherConnectionResult.Ready,checks};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||!['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)){console.error('Publisher diagnostics require main Actions.');process.exitCode=1;}
 else{const result=await Publisher_CheckConnection(process.env);console.log(JSON.stringify(result));if(result.result!==PublisherConnectionResult.Ready)process.exitCode=1;}
}
