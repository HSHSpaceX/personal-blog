const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

async function req(method, path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 500)}`);
  return data;
}

const SLUG = 'post-austria-history';

// 1. 找到文章
const items = await req('GET', `content_items?content_type=eq.article&slug=eq.${SLUG}&select=id,published_revision_id,author_id`);
if (!items || items.length !== 1) throw new Error('文章未找到或不唯一');
const item = items[0];
console.log('item:', item.id, 'published_revision:', item.published_revision_id);

// 2. 读取当前发布的修订
const revs = await req('GET', `content_revisions?id=eq.${item.published_revision_id}&select=id,revision_no,title,body,status`);
const cur = revs[0];
console.log('revision_no:', cur.revision_no, 'status:', cur.status);
console.log('原 asset_ids:', JSON.stringify(cur.body.asset_ids));

// 3. 构造纯文本 body
const newBody = { ...cur.body };
delete newBody.cover_asset_id;                 // 必须整个删除，设 null 会校验失败
newBody.asset_ids = [];                        // 不再引用任何资源
newBody.document = {
  ...newBody.document,
  blocks: (newBody.document.blocks || []).filter(b => b.type !== 'asset'),
};
// text 保持不变：schema 计算文本时会自动过滤 asset 块，因此与原 text 完全一致

console.log('新 blocks 类型:', newBody.document.blocks.map(b => b.type).join(','));
console.log('新 asset_ids:', JSON.stringify(newBody.asset_ids), 'cover 字段存在:', 'cover_asset_id' in newBody);

// 4. 新建一个修订（已批准，直接发布）
const now = new Date().toISOString();
const inserted = await req('POST', 'content_revisions', {
  item_id: item.id,
  revision_no: cur.revision_no + 1,
  title: cur.title,
  body: newBody,
  status: 'approved',
  submitted_at: now,
  resolved_at: now,
});
const newRev = inserted[0];
console.log('新修订:', newRev.id, 'rev_no:', newRev.revision_no);

// 5. 指回已发布版本
await req('PATCH', `content_items?id=eq.${item.id}`, { published_revision_id: newRev.id });
console.log('published_revision_id 已更新为', newRev.id);

// 6. 验证
const check = await req('GET', `content_items?id=eq.${item.id}&select=published_revision_id`);
console.log('最终 published_revision_id:', check[0].published_revision_id);
console.log('\n=== 完成 ===');
