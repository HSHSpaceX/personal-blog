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

test('等级门槛很高：一篇文章远不够升级，满级需要长期积累', () => {
  const L = levels();
  assert.equal(JSON.stringify(L.LEVELS.map((row) => row.exp)), JSON.stringify([0, 200, 600, 1400, 2600, 4400, 7000, 10500, 15000, 21000]));
  assert.equal(L.levelOf(0).level, 1);
  assert.equal(L.levelOf(199).level, 1);
  assert.equal(L.levelOf(200).level, 2);
  assert.equal(L.levelOf(599).level, 2);
  assert.equal(L.levelOf(600).level, 3);
  assert.equal(L.levelOf(20999).level, 9);
  assert.equal(L.levelOf(21000).level, 10);
  // 一篇文章只值 120 经验，单靠文章要 175 篇才满级。
  assert.equal(L.compute({ article: 1 }).exp, 120);
  assert.equal(L.levelOf(L.compute({ article: 1 }).exp).level, 1);
  assert.ok(Math.ceil(21000 / 120) >= 175);
  // 站长当前存量只到 Lv.2。
  const owner = L.compute({ article: 1, moment: 4, album: 1, comment: 0, follower: 2 });
  assert.equal(owner.exp, 243);
  assert.equal(owner.level, 2);
  assert.equal(owner.nextExp, 600);
  assert.equal(owner.remaining, 357);
});

test('等级卡结构：等级、分子分母、进度条与剩余经验一致', () => {
  const L = levels();
  const info = L.compute({ article: 1, moment: 4, album: 1, comment: 0, follower: 2, source: 'server' });
  const card = L.profileCardHTML(info);
  assert.match(card, /class="level-card" data-level="2" data-source="server"/);
  assert.match(card, /class="level-eyebrow">拾光等级</);
  assert.match(card, /class="level-number">Lv\.2</);
  assert.match(card, /<span class="level-exp"><b>243<\/b> <span>\/ 600<\/span><\/span>/);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /aria-valuemin="0" aria-valuemax="600" aria-valuenow="243"/);
  assert.match(card, /style="width:10\.8%"/);
  assert.match(card, /class="level-hint">距 Lv\.3 还差 357 经验值</);
  assert.match(card, /<span class="level-stat"><span>文章<\/span> <b>1<\/b><\/span>/);
  assert.match(card, /<span class="level-dot" aria-hidden="true">·<\/span>/);
  assert.equal((card.match(/class="level-dot"/g) || []).length, 4);
  assert.equal(card.includes('典藏'), false);
  assert.equal(card.includes('MEMBER LEVEL'), false);
});

test('满级状态：不再显示分母，提示已满级', () => {
  const L = levels();
  const info = L.compute({ article: 200, moment: 0, album: 0, comment: 0, follower: 0 });
  assert.equal(info.exp, 24000);
  assert.equal(info.level, 10);
  assert.equal(info.max, true);
  const card = L.profileCardHTML(info);
  assert.match(card, /data-max="true"/);
  assert.match(card, /<b>24000<\/b> <span>经验值 · 已满级<\/span>/);
  assert.match(card, /class="level-hint">已是最高等级</);
  assert.match(card, /style="width:100%"/);
  assert.doesNotMatch(card, /\/ 0</);
});

test('等级卡只描述公开数据，部分数据缺失时会提示补全', () => {
  const L = levels();
  const info = L.compute({ article: 0, moment: 0, album: 0, comment: 0, follower: 0, partial: true, source: 'server' });
  const card = L.profileCardHTML(info);
  assert.match(card, /data-source="server"/);
  assert.match(card, /部分公开数据暂时无法读取/);
  assert.doesNotMatch(card, /私信正文|dm_|service_role/);
  assert.equal(info.level, 1);
  assert.match(card, /width:0%/);
});

test('评论等级标识：有等级才渲染，带可读名称', () => {
  const L = levels();
  const chip = L.chipHTML(L.compute({ article: 1, moment: 4, album: 1, follower: 2 }));
  assert.match(chip, /class="level-chip" data-level="2"/);
  assert.match(chip, />Lv\.2</);
  assert.match(chip, /aria-label="拾光等级 Lv\.2 · 243\/600 经验值"/);
  assert.equal(L.chipHTML(null), '');
  assert.equal(L.chipHTML({}), '');
});

test('评论卡片占位：有 profileId 才挂占位，旧评论与匿名不挂', () => {
  const h = siteHarness([]);
  const withId = h.testComment({ id: 'c1', nick: '路人甲', username: 'passer', profileId: '778ac0a8-0693-4eb1-8b6e-81f1b96f697d', time: '2026-11-20', content: 'hi', status: 'approved' });
  assert.match(withId, /<span class="comment-level" data-level-user="778ac0a8-0693-4eb1-8b6e-81f1b96f697d"><\/span>/);
  const legacy = h.testComment({ id: 'c2', nick: 'HSH(站长)', time: '2026-09-27', content: 'Test', status: 'approved', legacy: true });
  assert.equal(legacy.includes('comment-level'), false);
  const anonymous = h.testComment({ id: 'c3', nick: '访客', time: '2026-11-21', content: 'hello', status: 'approved' });
  assert.equal(anonymous.includes('comment-level'), false);
});

test('评论等级批量装饰：一次分组查询填满所有占位', async () => {
  const calls = [];
  const context = {
    window: { BlogConfig: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } },
    URL, AbortSignal, Promise, Number, Math, Error, String, Object, Array,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      const target = new URL(String(url));
      const body = target.pathname.endsWith('/comments')
        ? [{ user_id: 'aaaaaaaa-1111-4111-8111-111111111111' }]
        : [
          { author_id: 'aaaaaaaa-1111-4111-8111-111111111111', content_type: 'article' },
          { author_id: 'aaaaaaaa-1111-4111-8111-111111111111', content_type: 'article' },
          { author_id: 'bbbbbbbb-2222-4222-8222-222222222222', content_type: 'moment' }
        ];
      return { ok: true, status: 200, json: async () => body, headers: { get: () => '0-0/0' } };
    }
  };
  context.window.window = context.window;
  context.window.fetch = context.fetch;
  vm.runInNewContext(read('js/levels.js'), context);
  const nodes = [
    { id: 'aaaaaaaa-1111-4111-8111-111111111111', innerHTML: '', getAttribute() { return this.id; } },
    { id: 'bbbbbbbb-2222-4222-8222-222222222222', innerHTML: '', getAttribute() { return this.id; } }
  ];
  const container = { querySelectorAll: () => nodes };
  const filled = await context.window.SiteLevels.decorateComments(container);
  assert.equal(filled, 2);
  // 2 篇文章 = 240 经验 → Lv.2；1 条动态 + 1 条评论 = 28 经验 → Lv.1
  assert.match(nodes[0].innerHTML, />Lv\.2</);
  assert.match(nodes[1].innerHTML, />Lv\.1</);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const target = new URL(call.url);
    assert.equal(target.origin, 'https://example.supabase.co');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers.apikey, 'sb_publishable_test');
    assert.match(target.searchParams.get('author_id') || target.searchParams.get('user_id'), /^in\.\(/);
    if (target.pathname.endsWith('/content_items')) assert.equal(target.searchParams.get('published_revision_id'), 'not.is.null');
    if (target.pathname.endsWith('/comments')) assert.equal(target.searchParams.get('status'), 'eq.approved');
  }
  assert.equal(calls.every((call) => !/service_role/.test(JSON.stringify(call.options))), true);
});

test('首页卡片：精选文章带右下角站标，普通文章不带；原有卡片类名保持不变', () => {
  const posts = [
    { slug: 'p-featured', title: '精选文章', category: '杂谈', tags: [], date: '2026-09-01', readingTime: 3, cover: 'assets/icon.jpg', excerpt: '摘要', featured: true },
    { slug: 'p-plain', title: '普通文章', category: '杂谈', tags: [], date: '2026-09-02', readingTime: 3, cover: 'assets/icon.jpg', excerpt: '摘要', featured: false }
  ];
  const h = siteHarness(posts);
  h.ui.home();
  const grid = h.ids.postGrid.innerHTML;
  assert.match(grid, /class="post-card glass-card has-tier"/, 'grid seal class');
  assert.match(grid, /class="post-card glass-card"/, 'plain card class');
  assert.equal((grid.match(/class="post-card /g) || []).length, 2);
  assert.equal((grid.match(/class="tier-seal"/g) || []).length, 1);
  assert.ok(grid.includes('aria-label="拾光手记精选文章"'));
  assert.ok(grid.includes('post-card-foot'));
  const rail = h.ids.featuredRail.innerHTML;
  assert.match(rail, /class="rail-card reveal glass-card has-tier"/);
  assert.ok(rail.includes('rail-card-foot'));
});

test('没有拾光等级脚本时安静降级：卡片仍正常渲染且无站标', () => {
  const posts = [{ slug: 'p-plain', title: '普通文章', category: '杂谈', tags: [], date: '2026-09-02', readingTime: 3, cover: 'assets/icon.jpg', excerpt: '摘要', featured: true }];
  const h = siteHarness(posts, { withLevels: false });
  h.ui.home();
  assert.match(h.ids.postGrid.innerHTML, /class="post-card glass-card"/);
  assert.equal(h.ids.postGrid.innerHTML.includes('tier-seal'), false);
  assert.equal(h.ids.postGrid.innerHTML.includes('post-card-foot'), true);
});

test('静态内容统计只归属站长，并忽略没有昵称的匿名评论', () => {
  const context = {
    window: {
      BLOG_POSTS: [{}, {}], BLOG_MOMENTS: [{}], SITE_ALBUMS: [{}, { visibility: 'private' }],
      SITE_COMMENTS: { a: [{ nick: 'HSH(站长)' }, { nick: '路人' }, {}], b: [{ nick: '站长' }] }
    }, URL, AbortSignal, Promise, Number, Math, Error, String, Object, Array
  };
  context.window.window = context.window;
  vm.runInNewContext(read('js/levels.js'), context);
  const L = context.window.SiteLevels;
  const own = L.localStats('hshspacex');
  assert.deepEqual({ article: own.article, moment: own.moment, album: own.album, comment: own.comment }, { article: 2, moment: 1, album: 1, comment: 2 });
  assert.equal(L.localStats('member_user').article, 0);
});

test('公开计数只请求已发布/已审核数据，并且不发送任何凭证', async () => {
  const calls = [];
  const context = {
    window: { BlogConfig: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } },
    URL, AbortSignal, Promise, Number, Math, Error, String, Object, Array,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      const count = new URL(String(url)).pathname.endsWith('/comments') ? 3 : 2;
      return { ok: true, status: 200, headers: { get: () => '0-0/' + count } };
    }
  };
  context.window.window = context.window;
  context.window.fetch = context.fetch;
  vm.runInNewContext(read('js/levels.js'), context);
  const stats = await context.window.SiteLevels.fetchStats('778ac0a8-0693-4eb1-8b6e-81f1b96f697d');
  assert.equal(stats.article, 2);
  assert.equal(stats.comment, 3);
  assert.equal(stats.partial, false);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    const target = new URL(call.url);
    assert.equal(target.origin, 'https://example.supabase.co');
    assert.equal(target.searchParams.get('select'), 'id');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers.Prefer, 'count=exact');
    if (target.pathname.endsWith('/content_items')) assert.equal(target.searchParams.get('published_revision_id'), 'not.is.null');
    if (target.pathname.endsWith('/comments')) assert.equal(target.searchParams.get('status'), 'eq.approved');
  }
  assert.equal(calls.every((call) => !/service_role/.test(JSON.stringify(call.options))), true);
});
