// Offline handoff only: no database connection, Secrets access or deployment.
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Install_Build} from './build-compatible-install.mjs';
import {Legacy_Plan} from './legacy-community-import.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const documents=['UI_ROUND3_ACCEPTANCE_20261018.md','FINAL_DEPLOYMENT_GUIDE_20261018.md','SUPABASE_OPERATOR_PACK_20261018.md','PRODUCTION_ACCEPTANCE_TEMPLATE_20261018.md','STORAGE_COMPATIBILITY_20261030.md'];
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function Operator_Build(directory,receipt=null){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 const sha=git('rev-parse','HEAD'),clean=!git('status','--porcelain');
 if(receipt&&receipt.main_sha!==sha)throw Error('Deployment receipt must match the checked-out Git SHA');
 const files=[],names=(await readdir(path.join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort();
 await mkdir(directory,{recursive:true});
 for(const file of [...documents.map(n=>'docs/'+n),'supabase/preflight.sql','supabase/postflight.sql',...names.map(n=>'supabase/migrations/'+n)]){
  const target=path.join(directory,file);await mkdir(path.dirname(target),{recursive:true});
  if(file.startsWith('docs/'))await writeFile(target,(await readFile(path.join(root,file),'utf8'))+'\n\n---\n交付副本绑定的实际 Git SHA：`'+sha+'`。生成时间：'+new Date().toISOString()+'。实际远端/CI/Cloudflare 证据见同包 `release-manifest.json`；生产 Supabase 升级和真实导入未由本工具执行。\n');
  else await copyFile(path.join(root,file),target);
  files.push({path:file,sha256:digest(await readFile(target))});
 }
 const compatible=await Install_Build(path.join(directory,'compatible-install')),plan=await Legacy_Plan();
 for(const name of (await readdir(path.join(directory,'compatible-install'))).sort()){
  files.push({path:'compatible-install/'+name,sha256:digest(await readFile(path.join(directory,'compatible-install',name)))});
 }
 await writeFile(path.join(directory,'legacy-plan.json'),JSON.stringify(plan,null,2)+'\n');
 const manifest={generated_at:new Date().toISOString(),main_sha:sha,worktree_clean:clean,remote_tracking_sha:git('rev-parse','origin/main'),
  receipt:receipt||{status:'not_checked',note:'A local build is not proof of push, CI, Pages or production database acceptance.'},
  migration_count:names.length,migrations:compatible,files,storage_compatibility_version:20261030,
  candidate_22_route:['compatible-install/diagnose-boundary-22.sql','compatible-install/202610130001_storage_compatibility.sql',...names.slice(23).map(n=>'supabase/migrations/'+n)],
  legacy_plan_digest:digest(JSON.stringify(plan)),
  legacy_counts:Object.fromEntries(['article','moment','album'].map(t=>[t,plan.entries.filter(e=>e.type===t).length])),
  legacy_unique_media:new Set(plan.entries.flatMap(e=>e.files.map(f=>f.path))).size,
  production_database_migrated:false,production_legacy_imported:false,production_auth_storage_accepted:false};
 await writeFile(path.join(directory,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const output=process.argv[process.argv.indexOf('--output')+1];if(!process.argv.includes('--output')||!output)throw Error('Use --output <local handoff directory>');
  const receiptFile=process.argv.includes('--receipt')?process.argv[process.argv.indexOf('--receipt')+1]:null;
  const manifest=await Operator_Build(path.resolve(output),receiptFile?JSON.parse(await readFile(receiptFile,'utf8')):null);
  console.log('Offline operator pack: '+manifest.main_sha+'; '+manifest.migration_count+' migrations; legacy digest '+manifest.legacy_plan_digest+'. No production operation performed.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
