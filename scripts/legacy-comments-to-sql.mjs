// Emit a reviewable SQL import. Never reads or exports legacy email/device fields.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/comments.js', import.meta.url), 'utf8'), context);
const comments = context.window.SITE_COMMENTS || {};
const uuid = (value) => {
  const hex = createHash('sha256').update(`personal-blog-comment:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const rows = Object.entries(comments).flatMap(([slug, entries]) => entries.map((entry) => ({ slug, ...entry })));
const byId = new Map(rows.map((row) => [row.id, row]));
const ordered = [];
const seen = new Set();
function visit(row) {
  if (seen.has(row.id)) return;
  seen.add(row.id);
  if (row.parentId && byId.has(row.parentId)) visit(byId.get(row.parentId));
  ordered.push(row);
}
rows.forEach(visit);
console.log('-- Review before running in Supabase SQL Editor. Legacy identities are intentionally unlinked.');
console.log('begin;');
for (const row of ordered) {
  if (!row.id || !row.nick || !row.content) continue;
  const parent = row.parentId && byId.get(row.parentId)?.slug === row.slug ? `'${uuid(row.parentId)}'` : 'null';
  const created = /^\d{4}-\d{2}-\d{2}$/.test(row.time || '') ? `${row.time}T12:00:00Z` : new Date().toISOString();
  console.log(`insert into public.comments (id, post_slug, user_id, parent_id, legacy_author_name, content, status, created_at)`);
  console.log(`values ('${uuid(row.id)}', ${quote(row.slug)}, null, ${parent}, ${quote(row.nick)}, ${quote(row.content)}, 'approved', ${quote(created)}) on conflict (id) do nothing;`);
}
console.log('commit;');
