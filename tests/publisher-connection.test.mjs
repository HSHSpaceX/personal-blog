import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Publisher_CheckConnection,PublisherConnectionResult} from '../scripts/check-publisher-connection.mjs';
const key='fixture-private-value',env={SUPABASE_URL:'https://hscqeswnscnvkdthhlfp.supabase.co',SUPABASE_SERVICE_ROLE_KEY:key};
test('Publisher diagnostics refuse unintended origin and malformed configuration before any request',async()=>{
 for(const change of [{SUPABASE_URL:'https://other.invalid'},{SUPABASE_SERVICE_ROLE_KEY:''},{SUPABASE_SERVICE_ROLE_KEY:key+'\n'}]){
  const report=await Publisher_CheckConnection({...env,...change},()=>{throw Error('Must not transmit');});assert.equal(report.result,PublisherConnectionResult.InvalidConfiguration);assert.ok(!JSON.stringify(report).includes(key));
 }
});
test('Publisher diagnostics stop on HTTP/transport failure without copying response bodies or exception secrets',async()=>{
 let calls=0;const report=await Publisher_CheckConnection(env,async()=>{calls++;return {ok:false,status:401,arrayBuffer:async()=>Buffer.from(key)};});
 assert.equal(calls,1);assert.equal(report.result,PublisherConnectionResult.ConnectionFailed);assert.equal(report.checks[1].http,401);assert.ok(!JSON.stringify(report).includes(key));
 const failed=await Publisher_CheckConnection(env,async()=>{throw Error(key);});assert.equal(failed.result,PublisherConnectionResult.ConnectionFailed);assert.ok(!JSON.stringify(failed).includes(key));
});
test('Publisher diagnostics use only four read-only RPCs and the exact production origin',async()=>{
 const calls=[];const report=await Publisher_CheckConnection(env,async(url,options)=>{calls.push(new URL(url).pathname);assert.equal(options.redirect,'error');assert.equal(options.body,'{}');return {ok:true,status:200,arrayBuffer:async()=>Buffer.from('[]')};});
 assert.equal(report.result,PublisherConnectionResult.Ready);assert.deepEqual(calls.map(x=>x.split('/').at(-1)),['community_release_preflight','community_publication_export','community_site_settings_export','community_deleted_export']);assert.ok(!JSON.stringify(report).includes(key));
});
