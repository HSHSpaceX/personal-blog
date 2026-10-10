import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

test('release guide lists all 18 migrations in execution order and requires real deployment acceptance',async()=>{
 const guide=await readFile(new URL('../docs/COMMUNITY_V2_RELEASE.md',import.meta.url),'utf8');
 const sql=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
 const listed=[...guide.matchAll(/^\d+\. (\d+_[a-z0-9_]+\.sql)$/gm)].map(match=>match[1]);
 assert.equal(sql.length,18);assert.deepEqual(listed,sql);
 assert.equal(listed.at(-2),'202610070004_category_raw_length.sql');assert.equal(listed.at(-1),'202610100001_safe_content_document.sql');
 assert.match(guide,/生产库只执行尚未应用的 migration/);assert.match(guide,/不能重新运行已经执行过的历史 migration/);
 assert.match(guide,/body\.document = \{ version: 1, blocks: \[\.\.\.\] \}/);assert.match(guide,/未应用时.*保存可能失败/);
 for(const required of ['链接协议限制','封面资源归属','图片 MIME 验证','旧纯文本 revision','拒绝重编','静态发布','CI 全绿不代表真实 Supabase Storage\/Auth 已验收','service_role 凭据不得放进前端'])assert.match(guide,new RegExp(required));
 assert.match(guide,/integration\/community-v2.*PR #4/);assert.doesNotMatch(guide,/feature\/community-v2|共 17 个/);
});
