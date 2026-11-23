const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

function levels() {
  const context = { window: {}, URL, AbortSignal, Promise, Number, Math, Error, String, Object, Array };
  context.window.window = context.window;
  vm.runInNewContext(read('js/levels.js'), context);
  return context.window.SiteLevels;
}

function element() {
  return {
    innerHTML: '', hidden: false, disabled: false, style: {}, children: [], attributes: {}, handlers: {},
    closest: () => ({ style: {} }), appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, fn) { this.handlers[name] = fn; }
  };
}

function siteHarness(posts, { withLevels = true } = {}) {
  const ids = Object.fromEntries(['featuredRail', 'featuredSection', 'railPrev', 'railNext', 'postGrid', 'postPagination'].map((id) => [id, element()]));
  const nav = element();
  ids.featuredRail.parentElement = { querySelector: () => nav };
  const location = { search: '' };
  const context = { window: { BLOG_POSTS: posts, BlogUrls: { postUrl: (slug) => 'posts/' + encodeURIComponent(slug) + '.html' }, location }, location, document: { getElementById: (id) => ids[id] || null, createElement: element }, URLSearchParams };
  if (withLevels) vm.runInNewContext(read('js/levels.js'), context);
  const source = read('js/site.js');
  const start = source.lastIndexOf('  if (window.BLOG_POSTS) {');
  assert.ok(start > 0);
  vm.runInNewContext(source.slice(0, start) + '  window.ui = {home:renderHome};  window.testComment = renderComment;\n})();', context);
  return { ids, ui: context.window.ui, testComment: context.window.testComment };
}

test('精选站标：只有 featured === true 才出现，普通文章没有站标', () => {
  const L = levels();
  assert.equal(L.isFeatured({ featured: true }), true);
  for (const post of [{}, { featured: false }, { featured: 'true' }, { featured: 1 }, { treasure: true }, { tier: 'featured' }]) {
    assert.equal(L.isFeatured(post), false, JSON.stringify(post));
  }
});

test('站标 HTML 保持单层结构，带固定可访问名称', () => {
  const L = levels();
  const html = L.sealHTML();
  assert.match(html, /class="tier-seal"/);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="拾光手记精选文章"/);
  assert.match(html, /tier-seal-mark/);
  assert.match(html, /tier-seal-label">精选</);
  assert.equal(html.includes('典藏'), false);
});

test('等级按数量判定：逐级要求递增，满级需要长期积累', () => {
  const L = levels();
  assert.equal(L.LEVELS.length, 11);
  assert.deepEqual(L.LEVELS.map((row) => row.level), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const key of ['article', 'featured', 'album', 'moment', 'comment', 'follower']) {
    const values = L.LEVELS.map((row) => row.need[key]).filter((v) => v !== undefined);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], key);
  }
  assert.equal(L.levelOf({ article: 1 }).level, 1);
  assert.equal(L.levelOf({ article: 1, moment: 2 }).level, 1);
  assert.equal(L.levelOf({ article: 1, moment: 3 }).level, 2);
  assert.equal(L.levelOf({ article: 50, moment: 200, album: 16, comment: 400, follower: 200 }).level, 2);
  assert.equal(L.levelOf({ article: 50, moment: 200, album: 16, comment: 400, follower: 200, featured: 15 }).level, 10);
  assert.ok(L.LEVELS[10].need.article >= 50);
});

test('等级卡结构：等级、分子分母、进度条与下一级要求一致', () => {
  const L = levels();
  const info = L.levelOf({ article: 1, moment: 4, album: 1, comment: 0, follower: 2, source: 'server' });
  assert.equal(info.level, 2);
  assert.equal(info.nextLevel, 3);
  assert.equal(info.totalRequired, 3);
  assert.equal(info.metRequired, 1);
  const card = L.profileCardHTML(info);
  assert.match(card, /class="level-card" data-level="2" data-source="server"/);
  assert.match(card, /class="level-eyebrow">拾光等级</);
  assert.match(card, /class="level-number">Lv\.2</);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /aria-valuemin="0" aria-valuemax="3" aria-valuenow="1"/);
  assert.match(card, /style="width:33\.3%"/);
  assert.match(card, /class="level-hint">距 Lv\.3 还差 2 项</);
  assert.match(card, /class="level-req-label">文章</);
  assert.match(card, /<b>3<\/b>\/3/);
  assert.equal(card.includes('典藏'), false);
  assert.equal(card.includes('MEMBER LEVEL'), false);
});

test('满级状态：不再显示分母，提示已满级', () => {
  const L = levels();
  const info = L.levelOf({ article: 50, moment: 200, album: 16, comment: 400, follower: 200, featured: 15 });
  assert.equal(info.level, 10);
  assert.equal(info.max, true);
  const card = L.profileCardHTML(info);
  assert.match(card, /data-max="true"/);
  assert.match(card, /class="level-hint">已是最高等级</);
  assert.match(card, /style="width:100%"/);
});

test('等级卡只描述公开数据，部分数据缺失时会提示补全', () => {
  const L = levels();
  const info = L.levelOf({ article: 0, moment: 0, album: 0, comment: 0, follower: 0, partial: true, source: 'server' });
  const card = L.profileCardHTML(info);
  assert.match(card, /data-source="server"/);
  assert.match(card, /部分公开数据暂时无法读取/);
  assert.doesNotMatch(card, /私信正文|dm_|service_role/);
  assert.equal(info.level, 0);
  assert.match(card, /width:0%/);
});

test('评论等级标识：有等级才渲染，带可读名称', () => {
  const L = levels();
  const chip = L.chipHTML(L.levelOf({ article: 1, moment: 4, album: 1, follower: 2 }));
  assert.match(chip, /class="level-chip" data-level="2"/);
  assert.match(chip, />Lv\.2</);
  assert.match(chip, /aria-label="拾光等级 Lv\.2 · 距 Lv\.3 还差 2 项"/);
  assert.equal(L.chipHTML(null), '');
  assert.equal(L.chipHTML({}), '');
});

test('评论卡片占位：有 profileId 才挂占位，旧评论与匿名不挂', () => {
  const h = siteHarness([]);
  const withId = h.testComment({ id: 'c1', nick: '路人甲', username: 'passer', profileId: '778ac0a8-0693-4eb1-8b6e-81f1b96f697d', time: '2026-11-20', content: 'hi', status: 'approved' });
  assert.match(withId, /<span class="comment-level" data-level-user="778ac0a8-0693-4eb1-8b6e-81f1b96f697d"><\/span>/);
  const legacy = h.testComment({ id: 'c2', nick: 'HSH(站长)', time: '2026-09-27', content: 'Test', status: 'approved', legacy: true });
  assert.equal(legacy.includes('comment-level'), false);
});

test('公开计数只请求已发布/已审核数据，并且不发送任何凭证', async () => {
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, headers: { get: () => '0-0/0' }, json: async () => [] };
  };
  const context = { window: {}, URL, AbortSignal, Promise, Number, Math, Error, String, Object, Array };
  context.window.window = context.window;
  context.window.fetch = fake;
  context.window.BlogConfig = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' };
  vm.runInNewContext(read('js/levels.js'), context);
  await context.window.SiteLevels.fetchStats('778ac0a8-0693-4eb1-8b6e-81f1b96f697d');
  assert.ok(calls.length >= 4);
  for (const call of calls) {
    assert.match(call.url, /published_revision_id=not\.is\.null/);
    assert.doesNotMatch(call.url, /service_role/);
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers.Authorization, undefined);
  }
});
