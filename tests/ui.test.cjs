const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const postUrl = slug => 'posts/' + encodeURIComponent(slug) + '.html';
const fixture = (i, featured = true) => ({slug:'post-'+i, title:'Title '+i, category:'分类',tags:['标签'],date:'2026-09-'+String(i+1).padStart(2,'0'),readingTime:3,cover:'assets/icon.jpg',excerpt:'Excerpt '+i,featured});
function siteHarness(posts, search='') {
  const element = () => ({innerHTML:'',hidden:false,disabled:false,style:{},closest:()=>({style:{}})});
  const ids = Object.fromEntries(['featuredRail','featuredSection','railPrev','railNext','postGrid','archiveList','archiveCategories'].map(id=>[id,element()]));
  const nav = element(); ids.featuredRail.parentElement={querySelector:()=>nav};
  const context = {window:{BLOG_POSTS:posts,BlogUrls:{postUrl},location:{search}},document:{getElementById:id=>ids[id]||null},URLSearchParams};
  const source=read('js/site.js');
  // Expose real renderers in the isolated VM without running unrelated page boot.
  const start=source.lastIndexOf('  if (window.BLOG_POSTS) {');
  assert.ok(start>0);
  vm.runInNewContext(source.slice(0,start)+'  window.ui = {home:renderHome,archive:renderArchive};\n})();',context);
  return {ids,nav,ui:context.window.ui};
}

test('only boolean featured true appears, sorted newest first; latest includes ordinary articles', () => {
  const posts=[fixture(0),fixture(4,false),fixture(1,'true'),fixture(2,1),fixture(3)];
  const h=siteHarness(posts);h.ui.home();
  assert.equal((h.ids.featuredRail.innerHTML.match(/class="rail-card /g)||[]).length,2);
  for (const slug of ['post-1','post-2','post-4']) assert.ok(!h.ids.featuredRail.innerHTML.includes(postUrl(slug)));
  assert.ok(h.ids.featuredRail.innerHTML.indexOf('posts/post-3.html')<h.ids.featuredRail.innerHTML.indexOf('posts/post-0.html'));
  assert.equal((h.ids.postGrid.innerHTML.match(/class="post-card /g)||[]).length,5);
  assert.ok(h.ids.postGrid.innerHTML.includes('posts/post-4.html'));
});

test('zero/single/all featured states hide section or controls and preserve all selections beyond four', () => {
  for (const posts of [[],[fixture(0,false)]]) {
    const h=siteHarness(posts);h.ui.home();assert.equal(h.ids.featuredSection.hidden,true);assert.equal(h.nav.hidden,true);
    assert.equal(h.ids.railNext.disabled,true);assert.equal(h.ids.featuredRail.innerHTML,'');
  }
  const single=siteHarness([fixture(0)]);single.ui.home();
  assert.equal(single.ids.featuredSection.hidden,false);assert.equal(single.nav.hidden,true);assert.equal(single.ids.railPrev.disabled,true);
  const many=siteHarness(Array.from({length:12},(_,i)=>fixture(i)));many.ui.home();
  assert.equal((many.ids.featuredRail.innerHTML.match(/class="rail-card /g)||[]).length,12);
  assert.equal((many.ids.postGrid.innerHTML.match(/class="post-card /g)||[]).length,9);
  assert.equal(many.nav.hidden,false);assert.equal(many.ids.railPrev.disabled,false);assert.equal(many.ids.railNext.disabled,false);
});

test('category/tag results use horizontal rows with static links and escaped metadata, not homepage cards', () => {
  const post=fixture(0);post.title='<img onerror=bad>';post.tags=['标签','<script>'];
  for (const search of ['?category='+encodeURIComponent('分类'),'?tag='+encodeURIComponent('标签'),'?category='+encodeURIComponent('分类')+'&tag='+encodeURIComponent('标签')]) {
    const h=siteHarness([post,{...fixture(1),category:'另一类',tags:['其他']}],search);h.ui.archive();
    const html=h.ids.archiveList.innerHTML;
    assert.equal((html.match(/class="archive-row /g)||[]).length,1);
    for (const cls of ['archive-thumb','archive-row-main','archive-row-side','archive-row-tags']) assert.ok(html.includes(cls));
    assert.ok(html.includes('posts/post-0.html'));assert.ok(html.includes('3 分钟阅读'));assert.ok(html.includes('datetime="2026-09-01"'));
    assert.ok(html.includes('archive.html?tag='+encodeURIComponent('标签')));assert.ok(!html.includes('post-card'));assert.ok(!html.includes('archive-post-grid'));
    assert.ok(html.includes('&lt;img onerror=bad&gt;'));assert.ok(!html.includes('<script>'));
  }
  assert.match(read('archive.html'), /<a href="posts\/post-austria-history\.html">/,'raw HTML retains real crawlable article link');
});

function themeHarness({saved='light',blocked=false}={}) {
  const handlers={},attrs={},writes=[];
  const button={setAttribute:(key,val)=>{attrs[key]=val;},addEventListener:(name,fn)=>{assert.ok(!handlers[name],'only one listener');handlers[name]=fn;}};
  const context={window:{},document:{getElementById:()=>button,documentElement:{dataset:{theme:saved}},dispatchEvent(){}},
    CustomEvent:class{},localStorage:{getItem(){if(blocked)throw Error('blocked');return saved;},setItem(key,val){if(blocked)throw Error('blocked');writes.push([key,val]);}}};
  vm.runInNewContext(read('js/theme.js'),context);
  return {theme:context.window.BlogTheme,state:context.document.documentElement.dataset,attrs,writes,click:()=>handlers.click()};
}

test('shared theme switches both ways, persists, updates aria/title and works with storage blocked', () => {
  const h=themeHarness();h.theme.setup();h.click();assert.equal(h.state.theme,'dark');
  assert.deepEqual(h.writes[0],['blog-theme','dark']);assert.equal(h.attrs['aria-label'],'切换到浅色模式');assert.equal(h.attrs.title,h.attrs['aria-label']);
  h.click();assert.equal(h.state.theme,'light');assert.equal(h.attrs.title,'切换深色模式');
  const restored=themeHarness({saved:'dark'});assert.equal(restored.state.theme,'dark');assert.equal(restored.attrs.title,'切换到浅色模式');
  const blocked=themeHarness({blocked:true});blocked.click();assert.equal(blocked.state.theme,'dark');blocked.click();assert.equal(blocked.state.theme,'light');
});

test('login/profile/admin use identical sun/moon SVG and common local theme setup', () => {
  const icon = file => read(file).match(/<button class="icon-btn" id="themeToggle"[\s\S]*?<\/button>/)[0];
  assert.equal(icon('login.html'),icon('profile.html'));assert.equal(icon('login.html'),icon('admin.html'));assert.equal(icon('login.html'),icon('index.html'));
  for (const file of ['login.html','profile.html','admin.html','index.html']) {
    assert.match(read(file),/<script src="js\/theme\.js\?v=1"><\/script>/);
    assert.match(icon(file),/class="icon-sun"/);assert.match(icon(file),/class="icon-moon"/);assert.doesNotMatch(icon(file),/◐/);
  }
  for (const file of ['js/login.js','js/profile.js','js/admin.js','js/site.js']) assert.match(read(file),/window\.BlogTheme\.setup\(\)/);
  assert.match(read('login.html'),/<meta name="description" content="[^"\n]*邀请制用户登录/);
});
