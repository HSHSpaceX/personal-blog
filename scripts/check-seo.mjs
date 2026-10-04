import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { SITE_BASE_URL } from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');
const full = (route = '') => new URL(route, SITE_BASE_URL).href;
const baseHost = new URL(SITE_BASE_URL).host;
const postsContext = { window: {} };
vm.runInNewContext(await read('js/posts.js'), postsContext, { filename: 'js/posts.js', timeout: 1000 });
const posts = Array.from(postsContext.window.BLOG_POSTS || []);
assert.ok(posts.length, 'No real posts found');

// Count decoded Unicode code points, not UTF-16 units or HTML entity bytes.
const decodeHtml = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
  if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(/^#x/i.test(entity) ? 2 : 1), /^#x/i.test(entity) ? 16 : 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity.toLowerCase()];
});
const attributes = (tag) => Object.fromEntries(Array.from(
  tag.matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g),
  ([, name, double, single, bare]) => [name.toLowerCase(), decodeHtml(double ?? single ?? bare ?? '')]
));
const imageTags = (markup) => Array.from(markup.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi), ([tag]) => attributes(tag));
const checkImages = (markup, label, requireDescription = false) => {
  const images = imageTags(markup);
  for (const image of images) {
    assert.ok(Object.hasOwn(image, 'alt'), `Missing img alt: ${label} (${image.src || 'no src'})`);
    if (requireDescription) assert.ok(image.alt.trim(), `Empty img alt: ${label} (${image.src || 'no src'})`);
  }
  return images;
};

const sitemap = await read('sitemap.xml');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expected = [
  full(), ...['about', 'archive', 'timeline', 'gallery', 'moments'].map(full),
  ...posts.map((post) => full(`posts/${post.slug}`))
];
assert.deepEqual(new Set(urls), new Set(expected), 'Sitemap URLs must exactly match indexable pages');
assert.equal(urls.length, expected.length, 'Sitemap contains duplicate URLs');
for (const address of urls) {
  assert.equal(new URL(address).host, baseHost, `Wrong sitemap host: ${address}`);
}
assert.equal((sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length, urls.length, 'Every sitemap URL needs a valid lastmod');
assert.match(await read('robots.txt'), new RegExp(`Sitemap: ${full('sitemap.xml').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

for (const address of urls) {
  const cleanRoute = new URL(address).pathname.slice(new URL(SITE_BASE_URL).pathname.length) || 'index.html';
  const route = cleanRoute.includes('.') ? cleanRoute : `${cleanRoute}.html`;
  const page = await read(route);
  const descriptions = Array.from(page.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi), ([tag]) => attributes(tag))
    .filter((meta) => meta.name?.toLowerCase() === 'description');
  assert.equal(descriptions.length, 1, `Expected one meta description: ${route}`);
  assert.ok(Object.hasOwn(descriptions[0], 'content'), `Missing description content: ${route}`);
  const length = Array.from(descriptions[0].content.trim()).length;
  assert.ok(length >= 25 && length <= 160, `Description must be 25–160 Unicode characters: ${route} (${length})`);
  checkImages(page, route, route === 'index.html');
  assert.ok(page.includes(`<link rel="canonical" href="${address}">`), `Missing canonical: ${route}`);
  assert.ok(!/<meta name="robots" content="[^"]*noindex/i.test(page), `Indexed page has noindex: ${route}`);
  for (const key of ['og:title', 'og:description', 'og:url', 'og:image']) {
    assert.ok(page.includes(`property="${key}"`), `Missing ${key}: ${route}`);
  }
  assert.ok(page.includes(`<meta property="og:url" content="${address}">`), `Wrong og:url: ${route}`);
}

// Exercise both real homepage image renderers, including featured cards even
// when the current data has no featured posts. Do not run unrelated page boot.
const siteSource = await read('js/site.js');
const boot = siteSource.lastIndexOf('  if (window.BLOG_POSTS) {');
assert.ok(boot > 0, 'Missing site.js boot boundary');
const homeContext = { window: { BlogUrls: { postUrl: (slug) => `posts/${encodeURIComponent(slug)}.html` } } };
vm.runInNewContext(siteSource.slice(0, boot) + '  window.homeCards = [renderPostCard, renderRailCard];\n})();', homeContext, { timeout: 1000 });
for (const post of [...posts, { ...posts[0], title: '中文标题 😀 & "引号" <示例>' }]) {
  for (const render of homeContext.window.homeCards) {
    const images = checkImages(render(post, 0), `homepage card: ${post.slug}`, true);
    assert.equal(images.length, 2, 'Homepage card must include a cover and author avatar');
    assert.equal(images[0].alt, post.title, 'Homepage cover alt must match the article title');
    assert.equal(images[1].alt, 'HSH站长头像', 'Homepage author avatar needs a meaningful alt');
  }
}
for (const post of posts) {
  const route = `posts/${post.slug}.html`;
  const page = await read(route);
  assert.ok(page.includes(`<h1 id="postTitle">${post.title}</h1>`), `Missing raw title: ${route}`);
  const body = page.match(/<div id="postContent" class="prose">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(body.replace(/<[^>]+>/g, '').trim().length > 30, `Empty raw article body: ${route}`);
  for (const value of [post.date, post.category, ...post.tags]) assert.ok(page.includes(value), `Missing post metadata ${value}: ${route}`);
  for (const listing of ['index.html', 'archive.html', 'timeline.html']) {
    assert.ok((await read(listing)).includes(`href="${route}"`), `Missing raw article link in ${listing}`);
  }
}
for (const page of ['admin.html', 'login.html', 'profile.html', 'search.html', 'post.html', '404.html']) {
  assert.match(await read(page), /<meta name="robots" content="noindex,follow">/, `Missing noindex: ${page}`);
}
for (const page of ['index.html', 'about.html', 'archive.html', 'timeline.html', 'gallery.html', 'moments.html', 'post.html', 'search.html', ...posts.map((post) => `posts/${post.slug}.html`)]) {
  const contents = await read(page);
  const helper = contents.indexOf('src="js/urls.js');
  const site = contents.indexOf('src="js/site.js');
  assert.ok(helper >= 0 && site > helper, `Shared static post URL helper must load before site.js: ${page}`);
}
for (const file of ['js/site.js', 'js/search.js']) {
  assert.ok(!(await read(file)).includes('post.html?slug='), `New article links use the legacy URL in ${file}`);
}
const legacy = await read('post.html');
assert.match(legacy, /location\.replace\(canonical\.href \+ location\.hash\)/, 'Legacy article URLs must redirect');
const feed = await read('feed.xml');
assert.equal((feed.match(/<item>/g) || []).length, posts.length, 'Feed must contain every real post once');
for (const post of posts) assert.ok(feed.includes(full(`posts/${post.slug}`)), `Feed missing ${post.slug}`);
for (const file of ['sitemap.xml', 'feed.xml', 'robots.txt', ...expected.map((address) => {
  const route = new URL(address).pathname.slice(new URL(SITE_BASE_URL).pathname.length) || 'index.html';
  return route.includes('.') ? route : `${route}.html`;
})]) {
  const contents = await read(file);
  assert.ok(!contents.includes('hshspacex.github.io'), `Old canonical host in ${file}`);
}
console.log(`SEO checks passed: ${urls.length} canonical URLs, descriptions (25–160 Unicode characters), image alts, ${posts.length} static post(s), feed, robots and noindex`);
