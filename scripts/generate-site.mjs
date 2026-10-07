import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),community=require('../js/community-public.js'),schema=require('../js/community-schema.js');
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITE_BASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, JOIN_REQUEST_URL, GITHUB_OWNER, GITHUB_REPO } from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(SITE_BASE_URL);
if (base.protocol !== 'https:' || base.search || base.hash || !SITE_BASE_URL.endsWith('/')) {
  throw new Error('SITE_BASE_URL must be an HTTPS directory URL ending in /');
}
const read = (name) => readFile(path.join(root, name), 'utf8');
const write = (name, value) => writeFile(path.join(root, name), value.replace(/\r\n/g, '\n'), 'utf8');
await write('js/config.js', `// Generated from site.config.mjs. Public values only.\nwindow.BlogConfig = Object.freeze(${JSON.stringify({ SITE_BASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, JOIN_REQUEST_URL, GITHUB_OWNER, GITHUB_REPO }, null, 2)});\n`);
const url = (name = '') => new URL(name, base).href;
const html = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const xml = html;
const plain = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const one = (source, pattern, replacement, label) => {
  if (!pattern.test(source)) throw new Error(`Missing ${label} in template`);
  return source.replace(pattern, replacement);
};
const gitDate = (file) => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: root, encoding: 'utf8' }).trim();
  } catch (error) {
    // Some restricted runners report EPERM after Git has already written stdout.
    return String(error.stdout || '').trim() || new Date().toISOString().slice(0, 10);
  }
};
const newer = (...dates) => dates.filter(Boolean).sort().at(-1);
const source = await read('js/posts.js');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'js/posts.js', timeout: 1000 });
const snapshot=community.validate(JSON.parse(await read('data/community-public.json')));
for(const item of snapshot.items)schema.validate(item.content_type,item.title,item.body);
const serialized=JSON.stringify(snapshot).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
await write('js/community-published.js','// Generated public snapshot. Do not edit.\nwindow.COMMUNITY_PUBLIC = '+serialized+';\n');
const posts = Array.from(context.window.BLOG_POSTS || []).concat(community.posts(snapshot));
if (!posts.length) throw new Error('No real posts in js/posts.js');
const slugs = new Set();
for (const post of posts) {
  if (!/^[a-z0-9-]+$/.test(post.slug) || slugs.has(post.slug)) throw new Error(`Invalid or duplicate slug: ${post.slug}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date) || !post.title || !plain(post.content)) throw new Error(`Incomplete post: ${post.slug}`);
  slugs.add(post.slug);
}
// Cloudflare Pages serves .html files at clean URLs and 308 redirects .html requests.
const postUrl = (post) => url(`posts/${post.slug}`);
const postPath = (post) => `posts/${post.slug}.html`;
const postsDate = gitDate('js/posts.js');
const communityDate = (type) => newer(...snapshot.items.filter(i => !type || i.content_type===type).map(i => i.published_at.slice(0,10)));
const articleDate = newer(postsDate,communityDate('article'));

function pageMeta(source, { title, description, address, image, type = 'website' }) {
  let output = source.replace(/\s*<!-- SEO_META_START -->[\s\S]*?<!-- SEO_META_END -->/g, '');
  output = output.replace(/^\s*<title>[^\n]*<\/title>\r?\n/gm, '');
  output = output.replace(/^\s*<meta name="description"[^\n]*>\r?\n/gm, '');
  output = output.replace(/^\s*<meta property="og:[^\n]*>\r?\n/gm, '');
  output = output.replace(/^\s*<link rel="canonical"[^\n]*>\r?\n/gm, '');
  const tags = `  <!-- SEO_META_START -->\n` +
    `  <title>${html(title)}</title>\n` +
    `  <meta name="description" content="${html(description)}">\n` +
    `  <link rel="canonical" href="${html(address)}">\n` +
    `  <meta property="og:type" content="${type}">\n` +
    `  <meta property="og:title" content="${html(title)}">\n` +
    `  <meta property="og:description" content="${html(description)}">\n` +
    `  <meta property="og:url" content="${html(address)}">\n` +
    `  <meta property="og:image" content="${html(image)}">\n` +
    `  <!-- SEO_META_END -->`;
  return one(output, /(<meta name="viewport"[^>]*>)/, `$1\n${tags}`, 'viewport');
}

function staticLinks(source, id, markup) {
  const pattern = new RegExp(`(<div[^>]*id="${id}"[^>]*>)[\\s\\S]*?(<\\/div>)`);
  return one(source, pattern, `$1\n${markup}\n$2`, id);
}

const publicPages = [
  ['index.html', '', '拾光手记 - 记录思考，也记录生活', '拾光手记是一个记录技术笔记、读书感想、旅行见闻与日常观察的个人博客，分享值得长期保留的思考与生活记录。'],
  ['about.html', 'about', '关于 - 拾光手记', '了解拾光手记的作者与写作初衷，看看这个个人博客如何记录技术探索、阅读感悟和生活中值得珍藏的片段。'],
  ['archive.html', 'archive', '归档 - 拾光手记', '按分类和标签浏览拾光手记的文章归档，从技术笔记、阅读记录到旅行见闻，寻找感兴趣的话题与值得重读的内容。'],
  ['timeline.html', 'timeline', '时间线 - 拾光手记', '沿着时间线浏览拾光手记的全部文章，回看不同阶段的技术探索、阅读思考与生活记录，感受日常积累的变化。'],
  ['gallery.html', 'gallery', '画廊 - 拾光手记', '浏览拾光手记的图片画廊，在照片中回看旅行途中的风景与日常生活的细节，留住那些值得慢慢欣赏的瞬间。'],
  ['moments.html', 'moments', '动态 - 拾光手记', '阅读拾光手记的最新动态，看看长文之外的随手记录、即时想法与生活片段，分享日常遇见的小事和新发现。']
];
const fallback = posts.map((post) => `          <a href="${html(postPath(post))}">${html(post.title)}</a>`).join('\n');
for (const [file, route, title, description] of publicPages) {
  let output = pageMeta(await read(file), {
    title, description, address: url(route), image: url('assets/covers/cover-travel.jpg')
  });
  if (file === 'index.html') output = staticLinks(output, 'postGrid', fallback);
  if (file === 'archive.html') output = staticLinks(output, 'archiveCategories', fallback);
  if (file === 'timeline.html') output = staticLinks(output, 'timelineList', fallback);
  await write(file, output);
}

const template = await read('post.html');
await mkdir(path.join(root, 'posts'), { recursive: true });
for (const post of posts) {
  const excerpt = plain(post.excerpt);
  const description = post.community ? community.description(post.public_item) : Array.from(Array.from(excerpt).length >= 25 ? excerpt : plain(post.content)).slice(0, 155).join('');
  let output = pageMeta(template, {
    title: `${post.title} - 拾光手记`, description,
    address: postUrl(post), image: url(post.cover || 'assets/icon.jpg'), type: 'article'
  });
  output = output.replace(/^\s*<meta name="robots"[^\n]*>\r?\n/gm, '');
  output = output.replace(/^\s*<script id="legacy-redirect">[\s\S]*?<\/script>\r?\n/gm, '');
  output = one(output, /(<meta name="viewport"[^>]*>)/, '$1\n  <base href="../">', 'post viewport');
  output = one(output, /<p class="eyebrow" id="postCategory"><\/p>/, `<p class="eyebrow" id="postCategory"><a href="archive.html?category=${encodeURIComponent(post.category)}">${html(post.category)}</a> · ${html(post.date)}</p>`, 'post category');
  output = one(output, /<h1 id="postTitle"><\/h1>/, `<h1 id="postTitle">${html(post.title)}</h1>`, 'post title');
  output = one(output, /<span id="postDate"><\/span>/, `<span id="postDate"><time datetime="${post.date}">${html(post.date)}</time></span>`, 'post date');
  output = one(output, /<span id="postReading"><\/span>/, `<span id="postReading">${Number(post.readingTime) || 1} 分钟阅读</span>`, 'post reading time');
  output = one(output, /<div class="post-tags" id="postTags"><\/div>/, `<div class="post-tags" id="postTags">${Array.from(post.tags || []).map((tag) => `<a class="tag-chip" href="archive.html?tag=${encodeURIComponent(tag)}">${html(tag)}</a>`).join('')}</div>`, 'post tags');
  output = one(output, /<div id="postAuthor"><\/div>/, `<div id="postAuthor">${community.authorHTML(post.author_profile||{username:'hshspacex',display_name:'HSH(站长)',avatar_url:url('assets/icon.jpg')})}</div>`, 'post author');
  output = one(output, /<div id="postContent" class="prose"><\/div>/, `<div id="postContent" class="prose">${post.content}</div>`, 'post content');
  // <base href="../"> keeps local assets and scripts working, so fragment links
  // need an explicit article path to stay on this page.
  output = output.replace(/href="#([^"]+)"/g, `href="${postPath(post)}#$1"`);
  output = output.replace('<meta property="og:type" content="article">', `<meta property="og:type" content="article">\n  <meta property="article:published_time" content="${html(post.published_at||post.date)}">`);
  output = output.replace(/(<meta name="viewport"[^>]*>)/, '$1\n  <!-- Generated by scripts/generate-site.mjs -->');
  await write(postPath(post), output);
}
for (const name of await readdir(path.join(root, 'posts'))) {
  if (!name.endsWith('.html') || slugs.has(name.slice(0, -5))) continue;
  const old = await read(`posts/${name}`);
  if (old.includes('<!-- Generated by scripts/generate-site.mjs -->')) await unlink(path.join(root, 'posts', name));
}

const sitemapUrls = [
  ...publicPages.map(([file, route]) => ({ loc: url(route), lastmod: newer(gitDate(file), route === '' || route === 'archive' || route === 'timeline' ? articleDate : route==='moments' ? newer(gitDate('js/moments.js'),communityDate('moment')) : route==='gallery' ? newer(gitDate('js/albums.js'),communityDate('album')) : '') })),
  ...posts.map((post) => ({ loc: postUrl(post), lastmod: newer(post.date, post.community ? post.published_at.slice(0,10) : postsDate) }))
];
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(({ loc, lastmod }) => `  <url><loc>${xml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`);
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${url('sitemap.xml')}\n`);
const feedItems = posts.slice().sort((a, b) => b.date.localeCompare(a.date)).map((post) => `    <item>\n      <title>${xml(post.title)}</title>\n      <link>${xml(postUrl(post))}</link>\n      <guid isPermaLink="true">${xml(postUrl(post))}</guid>\n      <pubDate>${new Date(post.published_at||`${post.date}T00:00:00Z`).toUTCString()}</pubDate>\n      <description>${xml(plain(post.excerpt || post.content))}</description>\n    </item>`).join('\n');
await write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>拾光手记</title>\n    <link>${xml(url())}</link>\n    <description>记录思考，也记录生活。</description>\n    <language>zh-CN</language>\n    <lastBuildDate>${new Date(`${newer(...posts.map((post) => post.date))}T00:00:00Z`).toUTCString()}</lastBuildDate>\n${feedItems}\n  </channel>\n</rss>\n`);
console.log(`Generated ${posts.length} static post(s), ${sitemapUrls.length} sitemap URL(s), feed and robots.txt for ${SITE_BASE_URL}`);
