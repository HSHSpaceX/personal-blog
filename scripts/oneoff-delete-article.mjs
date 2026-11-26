/* 一次性：按标题删除一篇文章（软删除，等价于站点自己的删除语义）。
 * 环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TITLE / APPLY(false=只检查)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const title = (process.env.TITLE || '').trim();
const apply = String(process.env.APPLY || 'false') === 'true';

if (!url || !key) { console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!title) { console.error('缺少 TITLE'); process.exit(1); }

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

/* 1) 找到标题完全匹配的文章（未删除） */
const candidates = await rest('/rest/v1/content_items?content_type=eq.article&deleted_at=is.null&select=id,slug,author_id,published_revision_id,created_at');
const findings = [];
for (const item of candidates || []) {
  const rows = await rest('/rest/v1/content_revisions?item_id=eq.' + item.id + '&select=id,title,revision_no,status&order=revision_no.desc');
  const latest = rows && rows[0];
  if (latest && String(latest.title).trim() === title) findings.push({ item, latest, rows });
}
if (!findings.length) { console.log('没有标题为「' + title + '」的文章。'); process.exit(0); }

for (const found of findings) {
  console.log('匹配：item=' + found.item.id + ' slug=' + found.item.slug);
  console.log('  最新版本 #' + found.latest.revision_no + ' ' + found.latest.id + ' 状态 ' + found.latest.status);
  console.log('  当前发布版本 =', found.item.published_revision_id || '（未发布）');
  console.log('  版本数 =', found.rows.length);
}

if (!apply) { console.log('干跑模式：未删除。确认后用 apply=true 重跑。'); process.exit(0); }

for (const found of findings) {
  const item = found.item;
  /* 与站点自身删除语义一致：清空发布指针 + 打删除时间 */
  await rest('/rest/v1/content_items?id=eq.' + item.id, { method: 'PATCH', body: JSON.stringify({ published_revision_id: null, deleted_at: new Date().toISOString() }) });
  try {
    await rest('/rest/v1/community_management_audit', { method: 'POST', body: JSON.stringify({ actor_id: item.author_id, action: 'delete_item', item_id: item.id, details: { previous_revision: item.published_revision_id, title: title, oneoff: true } }) });
  } catch (error) { console.log('审计记录写入失败（不影响删除）：' + error.message); }
  const after = await rest('/rest/v1/content_items?id=eq.' + item.id + '&select=id,deleted_at,published_revision_id');
  console.log('已删除：' + JSON.stringify(after[0]));
}
console.log('完成。接下来请触发一次同步，公开快照会自动移除这篇文章。');
