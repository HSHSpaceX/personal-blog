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
const COVER_ID = '9ec3c7ee-b6f4-4303-8b50-e8edcc747499';

// 1. 找到文章
const items = await req('GET', `content_items?content_type=eq.article&slug=eq.${SLUG}&select=id,published_revision_id`);
if (!items || items.length !== 1) throw new Error('文章未找到或不唯一');
const item = items[0];
const pubRevs = await req('GET', `content_revisions?id=eq.${item.published_revision_id}&select=id,revision_no,title,body`);
const cur = pubRevs[0];
console.log('item:', item.id, '当前修订 rev_no:', cur.revision_no);
console.log('当前 asset_ids:', JSON.stringify(cur.body.asset_ids));

// 2. 确认封面资源存在
const cover = await req('GET', `user_assets?id=eq.${COVER_ID}&select=id,original_name,mime_type,object_path,size_bytes`);
if (!cover || cover.length !== 1) throw new Error('封面资源不存在: ' + COVER_ID);
console.log('封面资源:', cover[0].original_name, cover[0].mime_type);

// 3. 构造 body：只保留封面
const newBody = { ...cur.body };
newBody.asset_ids = [COVER_ID];
newBody.cover_asset_id = COVER_ID;
// document 保持纯段落（封面不参与正文块）
newBody.document = { ...newBody.document, blocks: (newBody.document.blocks || []).filter(b => b.type !== 'asset') };
console.log('新 asset_ids:', JSON.stringify(newBody.asset_ids), 'cover:', newBody.cover_asset_id);

// 4. 新建已批准的修订
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

// 5. 关联封面资源到新修订
await req('POST', 'revision_assets', [{ revision_id: newRev.id, asset_id: COVER_ID }]);
console.log('已关联封面资源');

// 6. 发布新修订
await req('PATCH', `content_items?id=eq.${item.id}`, { published_revision_id: newRev.id });
console.log('published_revision_id ->', newRev.id);

// 7. 校验
const check = await req('GET', `content_items?id=eq.${item.id}&select=published_revision_id`);
console.log('最终 published_revision_id:', check[0].published_revision_id);
console.log('\n=== 完成（仅保留封面）===');
