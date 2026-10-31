import test from 'node:test';
import assert from 'node:assert/strict';
import {MailAcceptance_ValidateConfig,MailAcceptanceConfigResult,MailAcceptance_IsOwned} from '../scripts/production-mail-acceptance.mjs';
test('mail acceptance requires exact project, manual main SHA, recipient, approval and bounded action',()=>{
 const e={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:'a'.repeat(40),MAIL_SOURCE_SHA:'a'.repeat(40),SUPABASE_URL:'https://hscqeswnscnvkdthhlfp.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',PRODUCTION_MAIL_TEST_EMAIL:'test@example.invalid',MAIL_APPROVAL:'invite-recovery-cleanup-20261031',MAIL_TEST_TAG:'mail-20261031-12345678-1234-1234-1234-123456789abc',MAIL_ACTION:'invite'};
 assert.equal(MailAcceptance_ValidateConfig(e),MailAcceptanceConfigResult.Ready);
 for(const [k,v] of [['MAIL_ACTION','delete-all'],['MAIL_APPROVAL',''],['MAIL_SOURCE_SHA','b'.repeat(40)],['GITHUB_EVENT_NAME','push'],['SUPABASE_URL','https://other.supabase.co'],['PRODUCTION_MAIL_TEST_EMAIL',''],['MAIL_TEST_TAG','']])assert.equal(MailAcceptance_ValidateConfig({...e,[k]:v}),MailAcceptanceConfigResult.Rejected);
});
test('mail account ownership requires both exact recipient and unique provenance; existing users cannot be cleaned',()=>{
 const u={id:'12345678-1234-1234-1234-123456789abc',email:'test@example.invalid',user_metadata:{release_mail_test:'unique'}};
 assert.equal(MailAcceptance_IsOwned(u,'test@example.invalid','unique'),true);
 assert.equal(MailAcceptance_IsOwned(u,'other@example.invalid','unique'),false);
 assert.equal(MailAcceptance_IsOwned(u,'test@example.invalid','other'),false);
 assert.equal(MailAcceptance_IsOwned({...u,user_metadata:{}},'test@example.invalid','unique'),false);
});
