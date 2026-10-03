const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/search-core.js');
const urls = require('../js/urls.js');

const posts = [
  { slug: 'title', title: 'STM32 飞控设计', tags: [], category: '硬件', excerpt: '', content: '<p>基础介绍</p>', date: '2026-01-01' },
  { slug: 'tag', title: '标签文章', tags: ['tagneedle'], category: '随笔', excerpt: '', content: '<p>普通内容</p>', date: '2026-01-02' },
  { slug: 'category', title: '分类文章', tags: [], category: 'categoryneedle', excerpt: '', content: '<p>普通内容</p>', date: '2026-01-03' },
  { slug: 'excerpt', title: '摘要文章', tags: [], category: '随笔', excerpt: 'excerptneedle 出现在摘要', content: '<p>普通内容</p>', date: '2026-01-04' },
  { slug: 'body', title: '正文文章', tags: [], category: '随笔', excerpt: '', content: '<h2>章节</h2><p>bodyneedle 与 STM32 的故事，后面还有更多正文。</p>', date: '2026-09-30' },
  { slug: 'mixed', title: '普通标题', tags: ['飞控'], category: '随笔', excerpt: '', content: '<p>STM32 实战</p>', date: '2026-01-05' }
];
const moments = [{ id: 'm1', text: '星舰发射进展', time: '2026-03-01' }];
const comments = { title: [{ id: 'c1', nick: '访客', content: '公开评论内容', time: '2026-04-01' }] };
const index = core.createIndex(posts, moments, comments);

test('title, tag, category, excerpt, and body fields are searchable', () => {
  for (const [query, slug] of [
    ['飞控设计', 'title'], ['tagneedle', 'tag'], ['categoryneedle', 'category'],
    ['excerptneedle', 'excerpt'], ['bodyneedle', 'body']
  ]) {
    assert.equal(core.search(index, query)[0].slug, slug, query);
  }
});

test('multiple Chinese and English terms prefer more matches', () => {
  const hits = core.search(index, 'sTm32 飞控');
  assert.equal(hits[0].slug, 'title');
  assert.equal(hits[0].matched, 2);
  assert.equal(hits[1].slug, 'mixed');
  assert.equal(hits[1].matched, 2);
  assert.equal(core.search(index, '星舰')[0].type, 'moment');
  assert.equal(core.search(index, '公开评论')[0].type, 'comment');
});

test('title hits beat newer body-only hits, then equal scores use date', () => {
  assert.equal(core.search(index, 'STM32')[0].slug, 'title');
  const equal = core.createIndex([
    { slug: 'old', title: 'sameword', date: '2026-01-01' },
    { slug: 'new', title: 'sameword', date: '2026-02-01' }
  ], [], {});
  assert.equal(core.search(equal, 'sameword')[0].slug, 'new');
});

test('body matches show nearby plain-text context and no-result is empty', () => {
  const hit = core.search(index, 'bodyneedle')[0];
  assert.match(hit.snippet, /bodyneedle/);
  assert.doesNotMatch(hit.snippet, /<p>|<h2>/);
  assert.deepEqual(core.search(index, 'unfindableword'), []);
});

test('highlight escapes article and query-controlled markup', () => {
  const marked = core.highlight('<img src=x onerror=alert(1)> STM32 & friends', ['img', 'STM32']);
  assert.ok(marked.includes('&lt;<mark>img</mark>'));
  assert.ok(marked.includes('<mark>STM32</mark>'));
  assert.ok(!marked.includes('<img'));
  assert.ok(!marked.includes(' & friends'));
  assert.equal(core.search(index, '<script>alert(1)</script>').length, 0);
});

test('all article links use the shared static URL helper', () => {
  assert.equal(urls.postUrl('title'), 'posts/title.html');
  assert.equal(urls.postUrl('x y'), 'posts/x%20y.html');
});
