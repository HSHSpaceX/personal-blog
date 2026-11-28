import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createDatabase,modulePath} from './helpers/postgres.mjs';
import {createNativeDatabase,nativeConfigured} from './helpers/native-postgres.mjs';
import {Legacy_ValidateExecution} from '../scripts/legacy-community-import.mjs';
import {Operator_Build} from '../scripts/build-final-operator-pack.mjs';
const migrations=new URL('../supabase/migrations/',import.meta.url);
const names=(await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort();
const sql=await readFile(new URL('../supabase/postflight.sql',import.meta.url),'utf8');
test('Round 3 operator pack binds actual SHA, preserves all 27 migrations and has explicit untested production states',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'round3-operator-'));try{
  const manifest=await Operator_Build(directory);assert.match(manifest.main_sha,/^[a-f0-9]{40}$/);assert.equal(manifest.migration_count,27);assert.equal(manifest.receipt.status,'not_checked');
  for(const key of ['production_database_migrated','production_legacy_imported','production_auth_storage_accepted'])assert.equal(manifest[key],false);
  await assert.rejects(Operator_Build(directory,{main_sha:'0'.repeat(40)}),/receipt.*match/);
  for(const name of names){const current=await readFile(new URL(name,migrations),'utf8'),original=execFileSync('git',['show','f38df26334b0cf1c43d0c2b2a63a42d780b45a5e:supabase/migrations/'+name],{encoding:'utf8'});assert.equal(current.replace(/\r\n/g,'\n'),original.replace(/\r\n/g,'\n'),name+' immutable history');}
  const guide=await readFile(new URL('../docs/SUPABASE_OPERATOR_PACK_20261018.md',import.meta.url),'utf8');assert.deepEqual([...guide.matchAll(/^\d+\. (\d+_[a-z0-9_]+\.sql)$/gm)].map(m=>m[1]),names);
  for(const file of manifest.files){const bytes=await readFile(path.join(directory,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);if(file.path.startsWith('docs/'))assert.ok(bytes.toString().includes(manifest.main_sha));}
  assert.equal(manifest.migrations[26].source_lf_sha256,'d812f8e534f46d94693806558baa0fc4842c067930871dabc4220a7062bc1ead');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('Round 3 import gate requires reviewed checkout SHA, main/manual context and nonempty server configuration',()=>{
 const sha='a'.repeat(40),env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,LEGACY_SOURCE_SHA:sha,SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'};
 assert.doesNotThrow(()=>Legacy_ValidateExecution(env,sha));
 for(const change of [{LEGACY_SOURCE_SHA:'b'.repeat(40)},{GITHUB_SHA:'b'.repeat(40)},{LEGACY_SOURCE_SHA:''},{GITHUB_REF:'refs/heads/test'},{GITHUB_EVENT_NAME:'push'},{SUPABASE_URL:''},{SUPABASE_SERVICE_ROLE_KEY:'   '}])assert.throws(()=>Legacy_ValidateExecution({...env,...change},sha));
});
async function Deployment_Status(db){
 const results=await db.exec(sql);
 const status=results.flatMap(r=>r.rows||[]).find(r=>r.installation_status)?.installation_status;
 assert.ok(status,'read-only report remains available even when objects are absent');return status;
}
for(const [engine,create,configured] of [['PGlite',createDatabase,!!modulePath],['native PostgreSQL',createNativeDatabase,nativeConfigured]]){
 test('Round 3 '+engine+': read-only diagnostics distinguish empty, partial 23–27 and complete upgrade boundaries',{skip:!configured},async()=>{
  const db=await create({through:'000'});try{
   const before=(await db.query("select count(*)::int n from pg_class where relnamespace='public'::regnamespace")).rows[0].n;
   let report=await Deployment_Status(db);assert.equal(report.base_state,'not_installed');assert.equal(report.round2_state,'missing');
   assert.equal((await db.query("select count(*)::int n from pg_class where relnamespace='public'::regnamespace")).rows[0].n,before);
   for(let i=0;i<names.length;i++){
    await db.exec((await readFile(new URL(names[i],migrations),'utf8')).replace('create extension if not exists pgcrypto;',''));
    if(i<21)continue;
    report=await Deployment_Status(db);
    assert.equal(report.base_state,i>=25?'ready':'incomplete','boundary '+(i+1));
    assert.equal(report.round2_state,i===26?'ready':'missing','round 2 boundary '+(i+1));
   }
   assert.deepEqual((await db.query("select oid::regprocedure::text as signature from pg_proc where pronamespace='public'::regnamespace and prosecdef and not coalesce('search_path=\"\"'=any(proconfig),false)")).rows,[],'all business SECURITY DEFINER functions pin an empty search_path');
   await db.exec('alter table public.community_article_preferences disable row level security');
   report=await Deployment_Status(db);assert.equal(report.round2_state,'incomplete');assert.match(report.operator_action,/STOP/);
   await db.exec('alter table public.community_article_preferences enable row level security;grant execute on function public.community_submit_featured_article(uuid) to anon');
   report=await Deployment_Status(db);assert.equal(report.round2_state,'incomplete');assert.ok(report.round2_issues.some(s=>s.includes('RPC security')));
   await db.exec('revoke execute on function public.community_submit_featured_article(uuid) from anon;drop function public.profile_search(text,integer,integer)');
   report=await Deployment_Status(db);assert.equal(report.round2_state,'incomplete');assert.ok(report.round2_issues.some(s=>s.includes('profile_search')));
  }finally{await db.close();}
 });
 test('Round 3 '+engine+': original and trimmed Storage installations both upgrade through migration 27',{skip:!configured},async()=>{
  for(const trimmed of [false,true]){
   const db=await create({through:names[21]});try{
    if(trimmed)await db.exec('drop index storage.dm_media_object_path;drop trigger dm_media_immutable on storage.objects;drop trigger dm_media_orphan_guard on storage.objects;drop trigger dm_media_delete_cleanup on storage.objects');
    for(const name of names.slice(22))await db.exec(await readFile(new URL(name,migrations),'utf8'));
    const report=await Deployment_Status(db);assert.equal(report.base_state,'ready');assert.equal(report.round2_state,'ready');
    for(const table of ['user_assets','dm_assets'])assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid=$1::regclass and conname=$2 and confdeltype='r'",[table,table+'_storage_object_id_fkey'])).rows[0].n,1);
   }finally{await db.close();}
  }
 });
}
test('Round 3 DOM: failed upload registration and failed cleanup never reveal a private object path',{skip:!process.env.COMMUNITY_DOM_MODULE},async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
 try{const id='00000001-0000-4000-8000-000000000001';let path;
  w.BlogAuth={ready:async()=>{},user:()=>({id}),requireUser:()=>({id}),client:()=>({rpc:async()=>({error:{message:'private path '+path}}),storage:{from:()=>({upload:async p=>{path=p;return {};},remove:async()=>({error:{message:'failed '+path}})})}})};
  w.BackendCapabilities={requireUpgrade:async()=>{}};w.eval(await readFile(new URL('../js/community-schema.js',import.meta.url),'utf8'));w.eval(await readFile(new URL('../js/community-data.js',import.meta.url),'utf8'));
  await assert.rejects(w.CommunityData.upload(new w.File(['image'],'fixture.png',{type:'image/png'})),e=>{assert.match(e.message,/未保存资源引用/);assert.ok(!e.message.includes(id));assert.ok(!e.message.includes(path));return true;});
 }finally{w.close();}
});
