const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/202609300001_invite_auth.sql');

function dataHarness(role = 'guest') {
  const actor = role === 'guest' ? null : { id: 'actor-uuid' };
  const calls = [];
  const likes = new Set();
  const client = { from(table) {
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
  return { data: context.window.BlogData, calls, likes };
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
  assert.equal(await reader.data.toggleLike('post', 'post'), false);
  assert.equal(reader.likes.size, 0);
  assert.equal(reader.calls.find((call) => call.table === 'likes' && call.action === 'insert').payload.user_id, 'actor-uuid');
  const admin = dataHarness('admin');
  await admin.data.moderateComment('comment-id', 'approved');
  assert.equal(admin.calls[0].payload.status, 'approved');
  await admin.data.deleteComment('comment-id');
  assert.equal(admin.calls[1].action, 'delete');
});

test('PAT is validated against user and repository and never written to localStorage', async () => {
  const localWrites = [], sessionWrites = [], urls = [];
  const context = {
    window: { BlogConfig: { GITHUB_OWNER: 'HSHSpaceX', GITHUB_REPO: 'personal-blog' }, BlogAuth: { requireAdmin() {} } },
    localStorage: { removeItem() {}, setItem(...args) { localWrites.push(args); } },
    sessionStorage: { getItem() { return ''; }, setItem(...args) { sessionWrites.push(args); }, removeItem() {} },
    document: { addEventListener() {} },
    fetch: async (url) => { urls.push(url); return { ok: true, json: async () => url.endsWith('/user') ? { login: 'owner' } : { permissions: { push: true } } }; }
  };
  vm.runInNewContext(read('js/github-credentials.js'), context);
  await context.window.GitHubCredentials.connect('test-token');
  assert.deepEqual(urls, ['https://api.github.com/user', 'https://api.github.com/repos/HSHSpaceX/personal-blog']);
  assert.equal(context.window.GitHubCredentials.get(), 'test-token');
  assert.equal(localWrites.length, 0);
  assert.equal(sessionWrites.length, 1);
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
