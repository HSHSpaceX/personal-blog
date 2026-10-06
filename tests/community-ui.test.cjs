const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function element() {
  return { children: [], hidden: true, textContent: '', disabled: false, handlers: {},
    replaceChildren(...nodes) { this.children = nodes; }, appendChild(node) { this.children.push(node); },
    addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {} };
}
function accountHarness(initialRole, deferred = false, deferredData = false) {
  let role = initialRole, resolveReady, resolveData;
  const elements = Object.fromEntries([...read('account.html').matchAll(/\bid="([^"]+)"/g)].map(([,id]) => [id,element()]));
  const events = {}, redirects = [], resets = [];
  const auth = { user: () => role === 'guest' ? null : {id: 'account-one', email:'user@example.invalid'},
    isAdmin: () => role === 'admin',
    requireUser() { if (!this.user()) throw Error('Login required'); return this.user(); },
    ready: () => deferred ? new Promise(resolve => { resolveReady = resolve; }) : Promise.resolve(),
    resetPassword: async email => { resets.push(email); }, signOut: async () => { role = 'guest'; } };
  const dataPromise = deferredData ? new Promise(resolve => {resolveData=resolve;}) : Promise.resolve({display_name:'Test user'});
  const context = {window:{BlogAuth:auth,BlogTheme:{setup(){}},BlogData:{getProfile:()=>dataPromise,
    notificationCount:async()=>3,followerCount:async()=>4},GitHubCredentials:{clear(){}}},
    document:{getElementById:id=>elements[id],createElement:()=>element(),addEventListener:(name,fn)=>{events[name]=fn;}},
    location:{replace:href=>redirects.push(href)}};
  vm.runInNewContext(read('js/account.js'),context);
  return {elements,redirects,resets,release:()=>resolveReady(),releaseData:()=>resolveData({display_name:'Stale user'}),
    change(nextRole) { role=nextRole; events['blog-auth-change'](); }};
}

test('account has all personal sections and Round 2 submission/upload controls, keeps private messages a placeholder and stays noindex', () => {
  const html = read('account.html');
  for (const id of ['overview','profile','content','assets','notifications','direct-messages','connections','security','review-center','review-policies']) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(html,/<meta name="robots" content="noindex,follow">/);
  assert.doesNotMatch(html,/href="admin\.html|contenteditable/);
  assert.match(html,/id="communityUploadFile" type="file"/);
  for (const type of ['article','moment','album']) assert.match(html,new RegExp(`data-new-content="${type}"`));
  assert.match(html,/私信功能尚未开放/);
  assert.doesNotMatch(read('sitemap.xml'),/(?:account|messages|login|admin)(?:\.html)?<\/loc>/);
  for (const file of ['login.html','profile.html','messages.html','admin.html']) {
    assert.match(read(file),/href="account\.html"[^>]*rel="nofollow"/);
  }
  assert.match(read('js/login.js'),/\? next : 'account\.html'/);
});

test('account waits for verified identity, redirects guests, and gives ordinary users all personal sections', async () => {
  const guest = accountHarness('guest',true);
  assert.equal(guest.redirects.length,0);
  assert.equal(guest.elements.accountSections.hidden,true);
  guest.release(); await flush();
  assert.deepEqual(guest.redirects,['login.html?next=account.html']);
  const user = accountHarness('user'); await flush();
  assert.equal(user.elements.accountSections.hidden,false);
  assert.equal(user.elements['review-center'].hidden,true);
  assert.equal(user.elements.accountAdminNav.children.length,0);
  assert.match(user.elements.accountSummary.textContent,/3 条未读通知/);
  await user.elements.accountResetPassword.handlers.click();
  assert.deepEqual(user.resets,['user@example.invalid']);
});

test('account gives admin the same social overview plus review links and purges privileged links on demotion/logout', async () => {
  const h = accountHarness('admin'); await flush();
  assert.equal(h.elements.accountSections.hidden,false);
  assert.match(h.elements.accountSummary.textContent,/3 条未读通知/);
  assert.match(h.elements.accountConnections.textContent,/4 位关注者/);
  assert.equal(h.elements['review-center'].hidden,false);
  assert.equal(h.elements['review-policies'].hidden,false);
  assert.equal(h.elements.accountAdminNav.children.length,2);
  assert.equal(h.elements.accountReviewLinks.children[0].href,'admin.html#messages');
  assert.ok(h.elements.accountReviewLinks.children.every(link=>link.rel==='nofollow'));
  h.change('user'); await flush();
  assert.equal(h.elements.accountReviewLinks.children.length,0);
  assert.equal(h.elements['review-center'].hidden,true);
  h.change('guest'); await flush();
  assert.equal(h.elements.accountSections.hidden,true);
  assert.equal(h.elements.accountIdentity.textContent,'');
  assert.equal(h.redirects.at(-1),'login.html?next=account.html');
});

test('account ignores in-flight profile data after logout', async () => {
  const h = accountHarness('admin',false,true); await flush();
  h.change('guest'); h.releaseData(); await flush();
  assert.equal(h.elements.accountSummary.textContent,'');
  assert.equal(h.elements.accountReviewLinks.children.length,0);
  assert.equal(h.elements.accountSections.hidden,true);
});

test('public menu creates admin links only after role verification and removes them on demotion/logout', () => {
  let role='guest';
  const slot=element(), login=element(), menu=element();
  const auth={user:()=>role==='guest'?null:{id:'actor'},isAdmin:()=>role==='admin'};
  const context={window:{BlogAuth:auth,BlogUrls:{postUrl:slug=>slug},BlogData:{getProfile:async()=>null}},
    document:{querySelectorAll:selector=>({'[data-admin-links]':[slot],'.btn-login':[login],'.user-menu-wrap':[menu]}[selector]||[]),createElement:()=>element()}};
  const source=read('js/site.js');
  const boundary=source.indexOf('  function updateFavicon()');
  assert.ok(boundary>0);
  vm.runInNewContext(source.slice(0,boundary)+'window.apply=applyAuthUi;})();',context);
  context.window.apply(); assert.equal(slot.children.length,0); assert.equal(login.hidden,false);
  role='user'; context.window.apply(); assert.equal(slot.children.length,0); assert.equal(login.hidden,true);
  role='admin'; context.window.apply(); assert.equal(slot.children.length,3);
  assert.ok(slot.children.every(link=>link.rel==='nofollow'));
  role='user'; context.window.apply(); assert.equal(slot.children.length,0);
  role='guest'; context.window.apply(); assert.equal(slot.children.length,0); assert.equal(menu.hidden,true);
});

test('personal notifications ignore an old inbox response after logout', async () => {
  let user={id:'admin-one'}, resolveRows;
  const list=element(), status=element(), events={}, redirects=[];
  const context={window:{BlogTheme:{setup(){}},BlogAuth:{ready:async()=>{},user:()=>user},BlogData:{
    listNotifications:()=>new Promise(resolve=>{resolveRows=resolve;}),markNotificationsRead:async()=>assert.fail('stale inbox must not be marked read')}},
    document:{getElementById:id=>id==='messagesList'?list:status,querySelectorAll:()=>[],addEventListener:(name,fn)=>{events[name]=fn;}},
    location:{replace:href=>redirects.push(href)}};
  vm.runInNewContext(read('js/messages.js'),context); await flush();
  user=null; events['blog-auth-change'](); await flush();
  resolveRows([{title:'Private old notification',read:false}]); await flush();
  assert.equal(list.innerHTML,undefined);
  assert.deepEqual(redirects,['login.html?next=messages.html']);
  assert.doesNotMatch(status.textContent,/Private old notification/);
});
