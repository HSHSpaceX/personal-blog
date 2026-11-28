import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/comment-markdown.js', import.meta.url), 'utf8');
/* 提供 URL 和 location，模拟浏览器环境 */
const sandbox = { URL, location: { href: 'https://blog.example/post.html', origin: 'https://blog.example' }, console };
vm.runInNewContext(source, sandbox);
assert.ok(sandbox.CommentMarkdown, 'comment markdown module loaded');
const CommentMarkdown = sandbox.CommentMarkdown;

const base = 'https://blog.example/post.html';
const storageUrl = 'https://cdn.supabase.co/storage/v1/object/public/avatars/u1/comments/a.jpg';
const signedUrl = 'https://cdn.supabase.co/storage/v1/object/sign/community-assets/u1/file?token=short';

test('buildHtml keeps raw text inert while allowing the supported markdown subset', () => {
  const html = CommentMarkdown.buildHtml('<script>window.x=1</script>\n\n**粗** 与 *斜* 和 `code`', base);
  assert.ok(html.startsWith('<div class="comment-html"'));
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!/<script>/.test(html));
  assert.match(html, /<strong>粗<\/strong>/);
  assert.match(html, /<em>斜<\/em>/);
  assert.match(html, /<code>code<\/code>/);
});

test('images only render for allowed origins and safe data URIs', () => {
  const safe = CommentMarkdown.buildHtml(
    `![a](${storageUrl})\n![b](${signedUrl})\n![c](https://example.com/x.png)\n![d](data:image/png;base64,iVBOR)`,
    base,
  );
  for (const alt of ['a', 'b', 'c', 'd']) assert.match(safe, new RegExp(`<img [^>]*alt="${alt}"`));
  assert.ok(!/javascript:/i.test(safe));
  assert.ok(!safe.includes('onerror'));

  const unsafe = CommentMarkdown.buildHtml(
    '![x](javascript:alert(1))\n![y](data:image/svg+xml;base64,PHN2Zz4=)\n![z](https://example.com/x.png)',
    base,
  );
  assert.ok(!/src="javascript:/.test(unsafe), 'javascript: never becomes an image src');
  assert.ok(!unsafe.includes('data:image/svg+xml'), 'SVG data URI rejected');
  assert.match(unsafe, /<img [^>]*alt="z"/, 'safe https image still renders');
});

test('links are restricted to http(s)/mailto and carry rel nofollow', () => {
  const html = CommentMarkdown.buildHtml('[ok](https://example.com) [bad](javascript:alert(1))', base);
  assert.match(html, /href="https:\/\/example\.com"[^>]*rel="noopener noreferrer nofollow"/);
  assert.ok(!/href="javascript:alert/.test(html));
  assert.match(html, /bad\)/, 'unsafe link label stays plain text');
});

test('lists, quotes, code blocks and paragraphs stay escaped', () => {
  const html = CommentMarkdown.buildHtml('- one\n- two\n\n> quoted **bold**\n\n```\n<script>\n```', base);
  assert.match(html, /• one/);
  assert.match(html, /• two/);
  assert.match(html, /<blockquote>quoted <strong>bold<\/strong><\/blockquote>/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!/<script>/.test(html));
});

test('plain content without markdown uses paragraphs only', () => {
  const html = CommentMarkdown.buildHtml('line one\nline two\n\npara', base);
  assert.ok(!html.includes('<strong>'));
  assert.match(html, /line one line two/);
  assert.match(html, /<p>para<\/p>/);
});

test('safeImageSrc accepts storage/https/local/https and rejects javascript, svg-data, remote http', () => {
  assert.equal(CommentMarkdown.safeImageSrc(storageUrl, base), true, 'https storage public');
  assert.equal(CommentMarkdown.safeImageSrc(signedUrl, base), true, 'https storage signed');
  assert.equal(CommentMarkdown.safeImageSrc('https://example.com/x.png', base), true, 'https');
  assert.equal(CommentMarkdown.safeImageSrc('http://127.0.0.1:54321/storage/v1/object/public/avatars/u/x.jpg', base), true, 'local http storage');
  assert.equal(CommentMarkdown.safeImageSrc('data:image/png;base64,AAAA', base), true, 'data uri png');
  assert.equal(CommentMarkdown.safeImageSrc('javascript:alert(1)', base), false, 'javascript');
  assert.equal(CommentMarkdown.safeImageSrc('data:image/svg+xml;base64,x', base), false, 'svg data');
  assert.equal(CommentMarkdown.safeImageSrc('http://evil.example/x.png', base), false, 'remote http');
});
