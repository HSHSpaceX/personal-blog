const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/202609300001_invite_auth.sql');
const privacySql = read('supabase/migrations/202609300002_private_reactions.sql');

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
      in() { return this; }, order() { return this; }, maybeSingle() { return this; }, single() { return this; },
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

test('PAT stays in memory, is validated, and disappears after reload/logout', async () => {
  const localWrites = [], sessionWrites = [], sessionReads = [], sessionRemovals = [], urls = [];
  const listeners = [];
  const context = {
    window: { BlogConfig: { GITHUB_OWNER: 'HSHSpaceX', GITHUB_REPO: 'personal-blog' }, BlogAuth: { requireAdmin() {}, user: () => null } },
    localStorage: { removeItem() {}, setItem(...args) { localWrites.push(args); } },
    sessionStorage: { getItem(...args) { sessionReads.push(args); return ''; }, setItem(...args) { sessionWrites.push(args); }, removeItem(...args) { sessionRemovals.push(args); } },
    document: { addEventListener(name, listener) { listeners.push({ name, listener }); } },
    fetch: async (url) => { urls.push(url); return { ok: true, json: async () => url.endsWith('/user') ? { login: 'owner' } : { permissions: { push: true } } }; }
  };
  vm.runInNewContext(read('js/github-credentials.js'), context);
  await context.window.GitHubCredentials.connect('test-token');
  assert.deepEqual(urls, ['https://api.github.com/user', 'https://api.github.com/repos/HSHSpaceX/personal-blog']);
  assert.equal(context.window.GitHubCredentials.get(), 'test-token');
  assert.equal(localWrites.length, 0);
  assert.equal(sessionWrites.length, 0);
  assert.equal(sessionReads.length, 0);
  assert.equal(sessionRemovals.length, 1, 'old session PAT must be purged');
  listeners.find((entry) => entry.name === 'blog-auth-change').listener();
  assert.equal(context.window.GitHubCredentials.get(), '', 'logout clears memory');
  await context.window.GitHubCredentials.connect('test-token');
  vm.runInNewContext(read('js/github-credentials.js'), context);
  assert.equal(context.window.GitHubCredentials.get(), '', 'reload does not restore PAT');
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
