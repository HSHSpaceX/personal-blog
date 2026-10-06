const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/202609300001_invite_auth.sql');
const privacySql = read('supabase/migrations/202609300002_private_reactions.sql');
const hardeningSql = read('supabase/migrations/202610010003_security_hardening.sql');

function dataHarness(role = 'guest') {
  const actor = role === 'guest' ? null : { id: 'actor-uuid' };
  const calls = [];
  const likes = new Set();
  const follows = new Set();
  const client = { rpc(name, args) {
    calls.push({ rpc: name, args });
    if (name === 'like_counts') return Promise.resolve({ data: args.p_target_ids.filter((id) => likes.has(id)).map((id) => ({ target_id: id, like_count: 1 })), error: null });
    if (name === 'user_like_count') return Promise.resolve({ data: likes.size, error: null });
    return Promise.resolve({ data: 0, error: null });
  }, from(table) {
    const query = { table, action: '', payload: null, filters: {},
      select() { if (!this.action) this.action = 'select'; return this; },
      eq(key, value) { this.filters[key] = value; return this; },
      limit() { return this; }, in() { return this; }, order() { return this; }, maybeSingle() { return this; }, single() { return this; },
      insert(payload) { this.action = 'insert'; this.payload = payload; return this; },
      update(payload) { this.action = 'update'; this.payload = payload; return this; },
      delete() { this.action = 'delete'; return this; },
      then(resolve) {
        calls.push({ table: this.table, action: this.action, payload: this.payload, filters: this.filters });
        if (table === 'likes' && this.action === 'select') return Promise.resolve(resolve({ data: likes.has(this.filters.target_id) ? [{ user_id: actor.id }] : [], error: null }));
        if (table === 'likes' && this.action === 'insert') {
          if (likes.has(this.payload.target_id)) return Promise.resolve(resolve({ data: null, error: new Error('duplicate') }));
          likes.add(this.payload.target_id);
        }
        if (table === 'likes' && this.action === 'delete') likes.delete(this.filters.target_id);
        if (table === 'follows' && this.action === 'select') return Promise.resolve(resolve({ data: follows.has(this.filters.target_id) ? [{ follower_id: actor.id }] : [], error: null }));
        if (table === 'follows' && this.action === 'insert') follows.add(this.payload.target_id);
        if (table === 'follows' && this.action === 'delete') follows.delete(this.filters.target_id);
        return Promise.resolve(resolve({ data: this.payload || [], error: null }));
      }
    };
    return query;
  } };
  const auth = { ready: async () => {}, configured: () => true, client: () => client, user: () => actor,
    requireUser() { if (!actor) throw new Error('login required'); return actor; },
    isAdmin: () => role === 'admin',
    requireAdmin() { if (role !== 'admin') throw new Error('admin required'); }
  };
  const context = { window: { BlogAuth: auth } };
  vm.runInNewContext(read('js/blog-data.js'), context);
  return { data: context.window.BlogData, calls, likes, follows };
}

test('all user tables have RLS and restricted mutation policies', () => {
  for (const table of ['profiles', 'user_roles', 'comments', 'likes', 'follows']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(sql, /profiles_update_own[\s\S]*?using \(id = \(select auth\.uid\(\)\)\) with check \(id = \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(sql, /create policy \w+ on public\.user_roles for (insert|update|delete)/i);
  assert.match(sql, /comments_insert_self[\s\S]*?user_id = \(select auth\.uid\(\)\) and legacy_author_name is null and status = 'pending'/);
  assert.match(sql, /comments_admin_update[\s\S]*?using \(public\.is_admin\(\)\)/);
  assert.match(sql, /comments_admin_delete[\s\S]*?using \(public\.is_admin\(\)\)/);
  assert.match(sql, /primary key \(user_id, target_type, target_id\)/);
  assert.match(sql, /primary key \(follower_id, target_id\)/);
  assert.match(sql, /avatars_own_insert[\s\S]*?storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.match(sql, /file_size_limit, allowed_mime_types/);
  assert.doesNotMatch(sql, /moderator/);
  assert.doesNotMatch(sql, /create policy (likes|follows)_read.*using \(true\)/);
  assert.match(privacySql, /check \(role in \('user', 'admin'\)\)/);
});

test('raw likes and follows are private while public RPCs return counts only', async () => {
  assert.match(privacySql, /drop policy if exists likes_read on public\.likes/);
  assert.match(privacySql, /likes_read_own on public\.likes for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(privacySql, /follows_read_own on public\.follows for select to authenticated\s+using \(follower_id = \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(privacySql, /(?:likes|follows)_read\w* on public\.(?:likes|follows) for select to anon/);
  for (const signature of ['like_counts(text, text[])', 'follower_count(uuid)', 'user_like_count(uuid)']) {
    assert.ok(privacySql.includes(`revoke all on function public.${signature} from public`));
    assert.ok(privacySql.includes(`grant execute on function public.${signature} to anon, authenticated`));
  }
  assert.match(privacySql, /security definer set search_path = ''/);
  const guest = dataHarness();
  const counts = await guest.data.likes('post', ['one']);
  assert.equal(counts.one.count, 0);
  assert.deepEqual(guest.calls.map((call) => call.rpc), ['like_counts']);
  assert.equal(await guest.data.followerCount('target'), 0);
  assert.equal(await guest.data.userLikeCount('target'), 0);
  assert.ok(guest.calls.every((call) => call.rpc), 'anonymous client must never query raw reaction rows');
  const reader = dataHarness('user');
  await reader.data.likes('post', ['one']);
  const raw = reader.calls.find((call) => call.table === 'likes');
  assert.equal(raw.filters.user_id, 'actor-uuid');
  await reader.data.following('target');
  const follow = reader.calls.find((call) => call.table === 'follows');
  assert.equal(follow.filters.follower_id, 'actor-uuid');
});

test('guest cannot write and ordinary user cannot moderate', async () => {
  const guest = dataHarness();
  await assert.rejects(guest.data.addComment('post', 'hello'), /login required/);
  await assert.rejects(guest.data.toggleLike('post', 'post'), /login required/);
  await assert.rejects(guest.data.saveProfile({ bio: 'x' }), /login required/);
  await assert.rejects(guest.data.toggleFollow('owner'), /login required/);
  assert.equal(guest.calls.length, 0);
  const reader = dataHarness('user');
  await assert.rejects(reader.data.moderateComment('comment', 'approved'), /admin required/);
  await assert.rejects(reader.data.deleteComment('comment'), /admin required/);
  assert.equal(reader.calls.length, 0);
});

test('comment and like writes carry authenticated ID; admin moderation works', async () => {
  const reader = dataHarness('user');
  await reader.data.addComment('post', 'body', null);
  assert.equal(reader.calls[0].payload.user_id, 'actor-uuid');
  assert.equal(reader.calls[0].payload.status, 'pending');
  assert.equal(await reader.data.toggleLike('post', 'post'), true);
  assert.equal(reader.likes.size, 1);
  assert.equal((await reader.data.likes('post', ['post'])).post.count, 1);
  assert.equal(await reader.data.toggleFollow('owner'), true);
  assert.equal(reader.follows.size, 1);
  assert.equal(await reader.data.toggleFollow('owner'), false);
  assert.equal(reader.follows.size, 0);
  assert.equal(await reader.data.toggleLike('post', 'post'), false);
  assert.equal(reader.likes.size, 0);
  assert.equal(reader.calls.find((call) => call.table === 'likes' && call.action === 'insert').payload.user_id, 'actor-uuid');
  const admin = dataHarness('admin');
  await admin.data.moderateComment('comment-id', 'approved');
  assert.equal(admin.calls[0].payload.status, 'approved');
  await admin.data.deleteComment('comment-id');
  assert.equal(admin.calls[1].action, 'delete');
});

test('PAT validates repository access, restores only in the same account session, and clears on logout', async () => {
  const localWrites = [], sessionWrites = [], sessionReads = [], sessionRemovals = [], urls = [];
  const listeners = [];
  const session = new Map();
  let admin = true;
  const actor = { id: 'admin-id' };
  const context = {
    window: { BlogConfig: { GITHUB_OWNER: 'HSHSpaceX', GITHUB_REPO: 'personal-blog' }, BlogAuth: { requireAdmin() { if (!admin) throw new Error('admin required'); }, requireUser: () => actor, isAdmin: () => admin, user: () => admin ? actor : null }, addEventListener(name, listener) { listeners.push({ name, listener }); } },
    localStorage: { removeItem() {}, setItem(...args) { localWrites.push(args); } },
    sessionStorage: { getItem(key) { sessionReads.push([key]); return session.get(key) || ''; }, setItem(key, value) { sessionWrites.push([key,value]); session.set(key,value); }, removeItem(key) { sessionRemovals.push([key]); session.delete(key); } },
    document: { querySelectorAll: () => [], addEventListener(name, listener) { listeners.push({ name, listener }); } },
    fetch: async (url) => { urls.push(url); return { ok: true, json: async () => url.endsWith('/user') ? { login: 'owner' } : { permissions: { push: true } } }; }
  };
  vm.runInNewContext(read('js/github-credentials.js'), context);
  await context.window.GitHubCredentials.connect('test-token');
  assert.deepEqual(urls, ['https://api.github.com/user', 'https://api.github.com/repos/HSHSpaceX/personal-blog']);
  assert.equal(context.window.GitHubCredentials.get(), 'test-token');
  assert.equal(localWrites.length, 0);
  assert.deepEqual(sessionWrites, [['blog-gh-pat-temp','test-token'], ['blog-gh-pat-owner','admin-id']]);
  assert.equal(sessionReads.length, 0);
  assert.ok(sessionRemovals.some(([key]) => key === 'blog-gh-pat-session'), 'legacy session key must be purged');
  vm.runInNewContext(read('js/github-credentials.js'), context);
  assert.equal(context.window.GitHubCredentials.get(), 'test-token', 'same-account navigation preserves the existing session workflow');
  admin = false;
  listeners.find((entry) => entry.name === 'blog-auth-change').listener();
  assert.equal(context.window.GitHubCredentials.get(), '', 'logout clears memory');
  admin = true;
  await context.window.GitHubCredentials.connect('test-token');
  vm.runInNewContext(read('js/github-credentials.js'), context);
  assert.equal(context.window.GitHubCredentials.get(), 'test-token', 'only the matching account session restores PAT');
  session.set('blog-gh-pat-owner', 'other-admin');
  vm.runInNewContext(read('js/github-credentials.js'), context);
  assert.equal(context.window.GitHubCredentials.get(), '', 'a different account cannot restore the session token');
  context.window.GitHubCredentials.clear();
  assert.equal(context.window.GitHubCredentials.get(), '');
});

test('old local-only auth and comment write paths are gone', () => {
  const scripts = readdirSync(path.join(root, 'js')).filter((name) => name.endsWith('.js'));
  const contents = scripts.map((name) => read(`js/${name}`)).join('\n');
  assert.doesNotMatch(contents, /USER_HASH|PASS_HASH|ReaderAccount|textdb\.dev|abacus\.jasoncameron\.dev/);
  assert.doesNotMatch(contents, /localStorage\.setItem\(['"]blog-gh-token/);
  assert.doesNotMatch(contents, /PendingComments/);
  assert.match(read('profile.html'), /<meta name="robots" content="noindex,follow">/);
});

test('explicit grants exclude TRUNCATE, immutable columns and internal trigger RPCs', () => {
  assert.match(hardeningSql, /revoke all on table[\s\S]*?from public, anon, authenticated/);
  assert.match(hardeningSql, /grant select on public\.user_roles, public\.likes, public\.follows to authenticated/);
  assert.doesNotMatch(hardeningSql, /grant (?:all|truncate|references|trigger)/i);
  assert.match(hardeningSql, /grant insert \(post_slug, user_id, parent_id, content, status\)/);
  assert.match(hardeningSql, /revoke all on function public\.on_auth_user_created\(\), public\.touch_updated_at\(\),\s+public\.validate_comment_reply\(\) from public, anon, authenticated/);
  assert.match(hardeningSql, /cardinality\(p_target_ids\) > 100/);
  assert.match(hardeningSql, /array_ndims\(p_target_ids\)/);
  assert.match(hardeningSql, /security definer set search_path = ''/);
});

function credentialsHarness() {
  let actor = {id:'admin-one'}, admin = true, release;
  const events = {}, inputs = [{value:'typed-pat'}];
  const context = { window: { BlogConfig:{GITHUB_OWNER:'HSHSpaceX',GITHUB_REPO:'personal-blog'},
    BlogAuth:{user:()=>actor, isAdmin:()=>!!actor && admin,
      requireUser() { if (!actor) throw Error('user required'); return actor; },
      requireAdmin() { if (!actor || !admin) throw Error('admin required'); }},
    addEventListener(name, fn) { events[name] = fn; } },
    localStorage:{removeItem(){}}, sessionStorage:{removeItem(){}},
    document:{querySelectorAll:()=>inputs,addEventListener(name,fn){events[name]=fn;}},
    fetch:async (url)=> {
      if (url.endsWith('/user')) await new Promise((resolve)=>{release=resolve;});
      return {ok:true,json:async()=>({permissions:{push:true}})};
    }
  };
  vm.runInNewContext(read('js/github-credentials.js'), context);
  return {credentials:context.window.GitHubCredentials, inputs, events,
    release:()=>release(), change:(next, isAdmin = true)=>{actor=next;admin=isAdmin;events['blog-auth-change']();}};
}

test('logout/clear during PAT validation cannot restore token; demotion/account change purge memory and inputs', async () => {
  for (const change of [(h)=>h.change(null), (h)=>h.credentials.clear(), (h)=>h.change({id:'admin-one'},false)]) {
    const h = credentialsHarness();
    const pending = h.credentials.connect('test-token');
    change(h); h.release();
    await assert.rejects(pending, /admin required|登录状态已变化/);
    assert.equal(h.credentials.get(), '');
    assert.equal(h.inputs[0].value, '');
  }
  for (const change of [(h)=>h.change({id:'admin-two'}),(h)=>h.credentials.clear()]) {
    const h = credentialsHarness();
    const pending=h.credentials.connect('test-token'); h.release(); await pending;
    assert.equal(h.credentials.get(),'test-token');
    change(h); assert.equal(h.credentials.get(),'');
  }
  assert.doesNotMatch(read('js/admin.js'), /var token\s*=/, 'admin must not cache a duplicate PAT');
});

function authHarness({configured=true, initial=null, role='user', hash='', search='', missing=true, getUserGate=null} = {}) {
  let current=initial, listener, failSignOut=false, getUserCount=0;
  const notifications=[], replacements=[], calls=[];
  const location={hash,search,replace:(value)=>replacements.push(value)};
  const client={auth:{
    getUser:async()=>{getUserCount++; if (getUserGate) await getUserGate; return {data:{user:current},error:!current && missing ? {name:'AuthSessionMissingError'} : null};},
    onAuthStateChange:(fn)=>{listener=fn;},
    signInWithPassword:async()=>({data:{},error:null}),
    signOut:async()=>({data:{},error:failSignOut ? Error('network failure') : null}),
    resetPasswordForEmail:async(email,options)=>{calls.push(options);return {data:{},error:null};},
    updateUser:async()=>({data:{},error:null})
  },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role},error:null})})};
  const context={window:{BlogConfig:{SITE_BASE_URL:'https://hsh-personal-blog.pages.dev/',SUPABASE_URL:configured?'https://example.supabase.co':'',SUPABASE_PUBLISHABLE_KEY:configured?'public-test-key':''},supabase:{createClient:()=>client}},
    location,URL,URLSearchParams,setTimeout,console:{warn(){}},localStorage:{removeItem(){}},CustomEvent:class {constructor(name,options){this.name=name;this.detail=options.detail;}},
    document:{dispatchEvent:(event)=>notifications.push(event.detail)}};
  vm.runInNewContext(read('js/auth.js'), context);
  return {auth:context.window.BlogAuth, notifications, replacements,calls,setUser:(value)=>{current=value;},failLogout:()=>{failSignOut=true;},event:(name)=>listener(name), getUserCount:()=>getUserCount};
}

test('Auth safely handles missing config/session, checks DB role, and clears identity before failed signout', async () => {
  const blank=authHarness({configured:false}); await blank.auth.ready(); assert.equal(blank.auth.user(),null);
  await assert.rejects(blank.auth.signIn('test@example.invalid','test-input'), /尚未配置/);
  const guest=authHarness(); await guest.auth.ready(); assert.equal(guest.auth.user(),null); assert.equal(guest.auth.role(),'guest');
  const h=authHarness({initial:{id:'one',user_metadata:{role:'admin'}},role:'user'});
  await h.auth.ready(); assert.equal(h.auth.isAdmin(),false,'metadata must not grant admin');
  const a=authHarness({initial:{id:'admin'},role:'admin'}); await a.auth.ready(); assert.equal(a.auth.isAdmin(),true);
  a.failLogout(); const logout=a.auth.signOut(); assert.equal(a.auth.user(),null); assert.equal(a.auth.isAdmin(),false);
  await assert.rejects(logout,/network failure/); a.event('TOKEN_REFRESHED'); await new Promise(r=>setTimeout(r,5));
  assert.equal(a.auth.user(),null,'late refresh must not restore a locally signed-out user');
});

test('invite and password recovery redirect to canonical reset page; no public registration call', async () => {
  for (const type of ['invite','recovery']) {
    const h=authHarness({initial:{id:'one'},hash:'#type='+type}); await h.auth.ready();
    assert.equal(h.replacements[0],'https://hsh-personal-blog.pages.dev/login.html?reset=1');
  }
  const h=authHarness(); await h.auth.resetPassword('test@example.invalid');
  assert.equal(h.calls[0].redirectTo,'https://hsh-personal-blog.pages.dev/login.html?reset=1');
  assert.doesNotMatch(read('js/auth.js'), /\.signUp\s*\(/);
  assert.match(read('login.html'),/本站采用邀请制，目前不开放公开注册/);
});


test('overlapping SDK initial session event shares verified initialization before admin page gating', async () => {
  let release;
  const gate = new Promise(resolve=>{release=resolve;});
  const h=authHarness({initial:{id:'admin'},role:'admin',getUserGate:gate});
  const ready=h.auth.ready();
  h.event('INITIAL_SESSION');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(h.getUserCount(),1,'concurrent callers must share the same verification');
  release(); await ready;
  assert.equal(h.auth.isAdmin(),true,'ready must not resolve as guest before the admin lookup completes');
});

test('admin retains user comment/like/follow/profile and personal notification capabilities', async () => {
  for (const role of ['user','admin']) {
    const h = dataHarness(role);
    await h.data.addComment('post','social comment');
    assert.equal(h.calls[0].payload.status,role==='admin'?'approved':'pending');
    assert.equal(await h.data.toggleLike('post','social-post'),true);
    assert.equal(await h.data.toggleFollow('another-user'),true);
    await h.data.saveProfile({bio:'Social profile'});
    await h.data.listNotifications();
    await h.data.notificationCount();
    await h.data.markNotificationsRead();
    const calls = h.calls.filter(call=>call.table==='notifications');
    assert.equal(calls.length,3,'both users and admins use their personal inbox');
    assert.ok(calls.every(call=>call.filters.user_id==='actor-uuid'));
    assert.equal(calls[2].payload.read,true);
  }
  const guest=dataHarness();
  assert.equal((await guest.data.listNotifications()).length,0);
  assert.equal(await guest.data.notificationCount(),0);
  await guest.data.markNotificationsRead();
  assert.equal(guest.calls.length,0);
});
