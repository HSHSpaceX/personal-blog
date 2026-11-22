import fs from 'node:fs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLUG = 'post-austria-history';

const backup = JSON.parse(fs.readFileSync('/tmp/backup_full.json', 'utf8'));

async function req(method, path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// 1. 找到现有 item
const items = await req('GET', `content_items?slug=eq.${SLUG}&select=*`);
console.log('找到现有 item:', items.length);
if (items.length === 0) {
  console.log('文章不存在，将直接创建新文章');
}

let oldItemId = items[0]?.id;
let oldRevIds = [];
let oldAssetIds = [];

if (oldItemId) {
  const revs = await req('GET', `content_revisions?item_id=eq.${oldItemId}&select=id,revision_no,status`);
  oldRevIds = revs.map(r => r.id);
  console.log(`找到 ${revs.length} 个修订版本:`, revs.map(r => `${r.revision_no}(${r.status})`).join(', '));

  // 2. 找到关联的 user_assets（通过 revision_assets）
  if (oldRevIds.length > 0) {
    const revIdsIn = `(${oldRevIds.join(',')})`;
    const ras = await req('GET', `revision_assets?revision_id=in.${revIdsIn}&select=asset_id`);
    oldAssetIds = [...new Set(ras.map(r => r.asset_id))];
    console.log(`找到 ${oldAssetIds.length} 个关联附件:`, oldAssetIds);
  }
}

// 3. 删除顺序：先清理 restrict 外键的表，再删 item（级联删除其余）
if (oldItemId) {
  // 3a. community_article_preferences 使用 on delete restrict，必须先删
  if (oldRevIds.length > 0) {
    const revIdsIn = `(${oldRevIds.join(',')})`;
    console.log('清理 community_article_preferences...');
    await req('DELETE', `community_article_preferences?revision_id=in.${revIdsIn}`);
    console.log('已清理文章偏好设置');
  }
  // 3b. 删除 item 本体（级联删除 revisions、revision_assets、notifications 等）
  console.log('删除 content_item（级联删除 revisions 和 revision_assets）...');
  await req('DELETE', `content_items?id=eq.${oldItemId}`);
  console.log('已删除 item:', oldItemId);
}

// 3. 查找作者 ID（通过用户名）
console.log('查找作者 ID...');
const profiles = await req('GET', `profiles?username=eq.hshspacex&select=id,username`);
if (profiles.length === 0) throw new Error('找不到作者 hshspacex');
const authorId = profiles[0].id;
console.log('作者 ID:', authorId);

// 4. 创建新 item（保持原 slug，生成新 id）
console.log('创建新 content_item...');
const newItem = await req('POST', 'content_items', {
  author_id: authorId,
  content_type: 'article',
  slug: SLUG,
}).then(r => r[0]);
console.log('新 item id:', newItem.id);

// 5. 创建新 revision（复用原 body）
console.log('创建新 revision...');
const newRevision = await req('POST', 'content_revisions', {
  item_id: newItem.id,
  revision_no: 1,
  title: backup.title,
  body: backup.body,
  status: 'approved',
  submitted_at: new Date().toISOString(),
  resolved_at: new Date().toISOString(),
}).then(r => r[0]);
console.log('新 revision id:', newRevision.id);

// 6. 关联附件：只关联正文实际引用的资产（asset_ids + cover_asset_id）
const bodyRefs = [...new Set([...(backup.body.asset_ids || []), ...(backup.body.cover_asset_id ? [backup.body.cover_asset_id] : [])])];
console.log('正文引用的附件:', bodyRefs);
if (bodyRefs.length > 0) {
  console.log('关联附件到新 revision...');
  const existingAssets = await req('GET', `user_assets?id=in.(${bodyRefs.join(',')})&select=id`);
  const validAssetIds = existingAssets.map(a => a.id);
  if (validAssetIds.length !== bodyRefs.length) {
    throw new Error(`附件缺失：正文引用 ${bodyRefs.length} 个，但数据库只有 ${validAssetIds.length} 个`);
  }
  await req('POST', 'revision_assets', validAssetIds.map(aid => ({
    revision_id: newRevision.id,
    asset_id: aid,
  })));
  console.log('已关联附件:', validAssetIds);
}

// 7. 将新 revision 设为已发布版本
console.log('设置 published_revision_id...');
await req('PATCH', `content_items?id=eq.${newItem.id}`, {
  published_revision_id: newRevision.id,
});

// 8. 恢复 legacy 映射（slug 与 js/posts.js 静态老文章同名时必须存在，否则 sync 校验失败）
if (backup.legacy && backup.legacy.target_id) {
  console.log('恢复 legacy 映射...');
  await req('POST', 'community_legacy_mappings', {
    item_id: newItem.id,
    target_type: backup.legacy.target_type,
    target_id: backup.legacy.target_id,
    source_sha256: backup.legacy.source_sha256,
    published_at: backup.legacy.published_at,
  });
  console.log('legacy 映射已恢复:', backup.legacy.target_id);
}

console.log('\\n=== 完成 ===');
console.log(`新文章已创建: ${SLUG}`);
console.log(`item_id: ${newItem.id}`);
console.log(`revision_id: ${newRevision.id}`);
console.log(`附件数量: ${oldAssetIds.length}`);
