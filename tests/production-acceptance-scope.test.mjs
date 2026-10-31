import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Acceptance_ValidateConfig,AcceptanceConfigResult,Acceptance_AssertOwnedFile} from '../scripts/production-http-acceptance.mjs';
test('Hosted acceptance requires explicit main dispatch, exact source and production project',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',ACCEPTANCE_APPROVAL:'temporary-accounts-storage-20261031',GITHUB_SHA:'a'.repeat(40),ACCEPTANCE_SOURCE_SHA:'a'.repeat(40),SUPABASE_URL:'https://hscqeswnscnvkdthhlfp.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 assert.equal(Acceptance_ValidateConfig(env),AcceptanceConfigResult.Ready);
 for(const patch of [{GITHUB_ACTIONS:'false'},{GITHUB_EVENT_NAME:'schedule'},{GITHUB_REF:'refs/heads/feature'},{ACCEPTANCE_APPROVAL:''},{ACCEPTANCE_SOURCE_SHA:'b'.repeat(40)},{SUPABASE_URL:'https://other.invalid'}])assert.equal(Acceptance_ValidateConfig({...env,...patch}),AcceptanceConfigResult.Rejected);
});
test('Hosted cleanup rejects other users, buckets and traversal',()=>{
 const owner='00000001-0000-4000-8000-000000000001',file={owner,bucket:'dm-media',name:owner+'/00000002-0000-4000-8000-000000000002.png'};
 assert.doesNotThrow(()=>Acceptance_AssertOwnedFile(file,[owner]));
 for(const patch of [{owner:'00000003-0000-4000-8000-000000000003'},{bucket:'published-media'},{name:owner+'/../x.png'},{name:owner+'/x.png'}])assert.throws(()=>Acceptance_AssertOwnedFile({...file,...patch},[owner]),/scope/);
});
