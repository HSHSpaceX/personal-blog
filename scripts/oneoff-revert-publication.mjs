/* 一次性：把误提交的文章退回成草稿，线上仍保留上一版已发布内容。
 * 只在 GitHub Actions main 分支运行，使用 service role 密钥。
 * 环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SLUG / APPLY(false=只检查)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const slug = process.env.SLUG || 'post-austria-history';
const apply = String(process.env.APPLY || 'false') === 'true';

if (!url || !key) { console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const origin = new URL(url);
async function rest(route, options = {}) {
  const response = await fetch(new URL(route, origin), {
    ...options,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(route + ' -> ' + response.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

/* 1) 当前线上快照里这篇文章的版本（= 仍应公开展示的版本） */
const snapshot = JSON.parse(await readFile(path.join(root, 'data/community-public.json'), 'utf8'));
const publicItem = (snapshot.items || []).find((item) => item.slug === slug && item.content_type === 'article');
if (!publicItem) { console.error('快照中找不到 slug=' + slug); process.exit(1); }
console.log('快照版本 revision_id =', publicItem.revision_id, '| 标题:', publicItem.title);

/* 2) 数据库条目与全部版本 */
const items = await rest('/rest/v1/content_items?slug=eq.' + encodeURIComponent(slug) + '&select=id,slug,content_type,published_revision_id,author_id');
if (!items || !items.length) { console.error('数据库里找不到该 slug'); process.exit(1); }
const item = items[0];
console.log('item.id =', item.id, '| 当前 published_revision_id =', item.published_revision_id);

const revisions = await rest('/rest/v1/content_revisions?item_id=eq.' + item.id + '&select=id,revision_no,status,created_at&order=revision_no.desc');
console.log('版本列表（新 → 旧）:');
for (const revision of revisions) {
  const mark = revision.id === item.published_revision_id ? '  <== 当前已发布' : '';
  console.log('  #' + revision.revision_no, revision.id, revision.status, revision.created_at + mark);
}

/* 3) 目标：把「最新且已批准但不在快照里」的版本退回草稿 */
const stray = revisions.find((revision) => revision.id !== publicItem.revision_id && (revision.status === 'approved' || revision.status === 'pending'));
if (!stray) { console.log('没有需要退回的版本，数据库已是期望状态。'); process.exit(0); }
console.log('将退回成草稿: #' + stray.revision_no, stray.id, '(', stray.status, ')');

if (!apply) { console.log('干跑模式：未写入。确认无误后用 apply=true 重跑。'); process.exit(0); }

await rest('/rest/v1/content_revisions?id=eq.' + stray.id, { method: 'PATCH', body: JSON.stringify({ status: 'draft', submitted_at: null }) });
await rest('/rest/v1/content_items?id=eq.' + item.id, { method: 'PATCH', body: JSON.stringify({ published_revision_id: publicItem.revision_id }) });
await rest('/rest/v1/community_publication_state?item_id=eq.' + item.id, { method: 'PATCH', body: JSON.stringify({ status: 'pending', last_error: null }) });

const after = await rest('/rest/v1/content_items?id=eq.' + item.id + '&select=published_revision_id');
const afterRevision = await rest('/rest/v1/content_revisions?id=eq.' + stray.id + '&select=id,status');
console.log('完成：published_revision_id =', after[0].published_revision_id, '| 误提交版本状态 =', afterRevision[0].status);
