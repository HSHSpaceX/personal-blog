// Run only against a test project with two regular users and one admin.
// Environment credentials are never printed, persisted, or sent to GitHub.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function makeClient(base, key, transport = fetch) {
  assert.match(base, /^https:\/\//);
  return async function request(route, method = 'GET', token, body, extra = {}) {
    const headers = { apikey: key, Prefer: 'return=representation', ...extra };
    // A publishable key is not a JWT. Anonymous requests need apikey only.
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined && !(body instanceof Uint8Array)) headers['Content-Type'] = 'application/json';
    const response = await transport(base.replace(/\/$/, '') + route, {
      method, headers, signal: AbortSignal.timeout(15000),
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: response.status, data };
  };
}

export async function runAcceptance(env = process.env, transport = fetch) {
  const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'TEST_USER_EMAIL', 'TEST_USER_PASSWORD', 'TEST_OTHER_EMAIL', 'TEST_OTHER_PASSWORD', 'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}; live RLS test was not run.`);
  const request = makeClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, transport);
  const emptyOrDenied = (r, label) => assert.ok([401, 403].includes(r.status) ||
    (r.status === 200 && Array.isArray(r.data) && !r.data.length), label);
  const denied = (r, label) => assert.ok([401, 403].includes(r.status), label);
  const ok = (r, status, label) => assert.equal(r.status, status, label);
  const one = (r, status, label) => { ok(r, status, label); assert.equal(r.data.length, 1, label); return r.data[0]; };
  async function login(prefix) {
    const r = await request('/auth/v1/token?grant_type=password', 'POST', null, {
      email: env[`TEST_${prefix}_EMAIL`], password: env[`TEST_${prefix}_PASSWORD`]
    });
    ok(r, 200, 'test account login failed');
    assert.ok(r.data.access_token && r.data.user?.id, 'missing test session');
    return { id: r.data.user.id, token: r.data.access_token };
  }
  const user = await login('USER'), other = await login('OTHER'), admin = await login('ADMIN');
  assert.equal(new Set([user.id, other.id, admin.id]).size, 3, 'use three distinct test accounts');
  for (const [actor, expected] of [[user, 'user'], [other, 'user'], [admin, 'admin']]) {
    const row = one(await request(`/rest/v1/user_roles?user_id=eq.${actor.id}`, 'GET', actor.token), 200, 'role preflight failed');
    assert.equal(row.role, expected, 'test account role is incorrect');
    one(await request(`/rest/v1/profiles?id=eq.${actor.id}`, 'GET', actor.token), 200, 'profile missing; apply migrations before inviting users');
  }
  // Fail before writes if these test-only relationships already exist.
  for (const actor of [user, other]) {
    const r = await request(`/rest/v1/follows?follower_id=eq.${actor.id}&target_id=eq.${admin.id}`, 'GET', actor.token);
    ok(r, 200, 'follow preflight failed'); assert.equal(r.data.length, 0, 'test accounts must not already follow test admin');
  }
  const marker = 'rls-audit-' + crypto.randomUUID();
  const commentsRoute = `/rest/v1/comments?post_slug=eq.${marker}`;
  const like = (actor) => ({ user_id: actor.id, target_type: 'post', target_id: marker });
  const follow = (actor) => ({ follower_id: actor.id, target_id: admin.id });
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64'));
  const avatarPaths = [user, other].map((actor) => `${actor.id}/${marker}.png`);
  let roleAttempted = false;
  const cleanupErrors = [];
  let failure;
  try {
    // Seed the OTHER user's identities before attempting to enumerate them.
    one(await request('/rest/v1/likes', 'POST', other.token, like(other)), 201, 'seed like failed');
    one(await request('/rest/v1/follows', 'POST', other.token, follow(other)), 201, 'seed follow failed');
    for (const table of ['likes', 'follows']) {
      emptyOrDenied(await request(`/rest/v1/${table}`, 'GET'), `anon enumerated ${table} identities`);
      const col = table === 'likes' ? 'user_id' : 'follower_id';
      emptyOrDenied(await request(`/rest/v1/${table}?${col}=eq.${other.id}`, 'GET', user.token), `user read other ${table} identities`);
    }
    for (const [table, payload] of [['likes', like(user)], ['follows', follow(user)], ['comments', {post_slug:marker,user_id:user.id,content:marker,status:'pending'}]]) {
      denied(await request(`/rest/v1/${table}`, 'POST', null, payload), `anon wrote ${table}`);
    }
    const profile = one(await request(`/rest/v1/profiles?id=eq.${other.id}`), 200, 'public profile failed');
    emptyOrDenied(await request(`/rest/v1/profiles?id=eq.${other.id}`, 'PATCH', user.token, {bio:profile.bio}), 'user changed other profile');
    const own = one(await request(`/rest/v1/profiles?id=eq.${user.id}`), 200, 'own profile failed');
    one(await request(`/rest/v1/profiles?id=eq.${user.id}`, 'PATCH', user.token, {bio:own.bio}), 200, 'own profile update failed');
    denied(await request(`/rest/v1/profiles?id=eq.${user.id}`, 'PATCH', user.token, {id:other.id}), 'user changed profile identity');
    roleAttempted = true;
    denied(await request(`/rest/v1/user_roles?user_id=eq.${user.id}`, 'PATCH', user.token, {role:'admin'}), 'user escalated role');
    denied(await request('/rest/v1/likes', 'POST', user.token, like(other)), 'user forged liker');
    denied(await request('/rest/v1/follows', 'POST', user.token, follow(other)), 'user forged follower');
    const comment = {post_slug:marker,user_id:user.id,content:marker,status:'pending'};
    denied(await request('/rest/v1/comments', 'POST', user.token, {...comment,user_id:other.id}), 'user forged comment author');
    denied(await request('/rest/v1/comments', 'POST', user.token, {...comment,status:'approved'}), 'user bypassed moderation on insert');
    denied(await request('/rest/v1/comments', 'POST', user.token, {...comment,created_at:'2000-01-01T00:00:00Z'}), 'user forged timestamp');
    const row = one(await request('/rest/v1/comments', 'POST', user.token, comment), 201, 'pending comment insert failed');
    const rowRoute = `/rest/v1/comments?id=eq.${row.id}`;
    for (const token of [undefined, other.token]) emptyOrDenied(await request(rowRoute, 'GET', token), 'pending comment leaked');
    one(await request(rowRoute, 'GET', user.token), 200, 'author cannot read own pending');
    for (const actor of [user, other]) {
      emptyOrDenied(await request(rowRoute, 'PATCH', actor.token, {status:'approved'}), 'nonadmin approved comment');
      emptyOrDenied(await request(rowRoute, 'DELETE', actor.token), 'nonadmin deleted comment');
    }
    one(await request(rowRoute, 'PATCH', admin.token, {status:'approved'}), 200, 'admin moderation failed');
    one(await request(rowRoute), 200, 'approved comment not public');
    one(await request('/rest/v1/comments', 'POST', other.token, {...comment,user_id:other.id,parent_id:row.id}), 201, 'reply failed');
    const invalidReply = await request('/rest/v1/comments', 'POST', other.token, {...comment,user_id:other.id,post_slug:marker+'-other',parent_id:row.id});
    assert.ok([400,403].includes(invalidReply.status), 'cross-post reply accepted');
    for (const actor of [user, other]) {
      const table = actor === user ? 'likes' : 'follows';
      const payload = actor === user ? like(user) : follow(other);
      if (actor === user) one(await request(`/rest/v1/${table}`, 'POST', actor.token, payload), 201, 'own like failed');
      ok(await request(`/rest/v1/${table}`, 'POST', actor.token, payload), 409, `duplicate ${table} accepted`);
    }
    one(await request('/rest/v1/follows', 'POST', user.token, follow(user)), 201, 'own follow failed');
    const counts = await request('/rest/v1/rpc/like_counts', 'POST', null, {p_target_type:'post',p_target_ids:[marker]});
    const counted = one(counts, 200, 'public like count failed');
    assert.equal(Number(counted.like_count), 2);
    assert.deepEqual(Object.keys(counted).sort(), ['like_count','target_id'], 'count RPC exposed identities');
    for (const [name,args] of [['follower_count',{p_target_id:admin.id}],['user_like_count',{p_user_id:user.id}]]) {
      const r = await request(`/rest/v1/rpc/${name}`, 'POST', null, args);
      ok(r, 200, 'public count failed'); assert.equal(typeof r.data, 'number'); assert.ok(r.data >= 1);
    }
    for (const ids of [Array(101).fill(marker), [[marker],[marker]], [null], ['x'.repeat(161)]]) {
      ok(await request('/rest/v1/rpc/like_counts', 'POST', null, {p_target_type:'post',p_target_ids:ids}), 400, 'unbounded count RPC input accepted');
    }
    for (const name of ['on_auth_user_created','touch_updated_at','validate_comment_reply']) {
      const r = await request(`/rest/v1/rpc/${name}`, 'POST', user.token, {});
      assert.ok([401,403,404].includes(r.status), 'internal trigger exposed as RPC');
    }
    const upload = (path, token, content = png, type = 'image/png', method = 'POST') =>
      request(`/storage/v1/object/avatars/${path}`, method, token, content, {'Content-Type':type});
    const storageDenied = (r, label) => {
      // Storage sometimes wraps RLS errors in HTTP 400; require its auth error body.
      assert.ok([401,403].includes(r.status) || (r.status === 400 &&
        (/row.level security|unauthorized|permission denied/i.test(r.data?.message || '') || ['401','403'].includes(String(r.data?.statusCode)))), label);
    };
    storageDenied(await upload(avatarPaths[0], null), 'anon avatar upload accepted');
    ok(await upload(avatarPaths[1], other.token), 200, 'own avatar upload failed');
    storageDenied(await upload(avatarPaths[1], user.token, png, 'image/png', 'PUT'), 'user overwrote other avatar');
    const foreignDelete = await request('/storage/v1/object/avatars', 'DELETE', user.token, {prefixes:[avatarPaths[1]]});
    if (foreignDelete.status === 200) assert.deepEqual(foreignDelete.data, [], 'user deleted other avatar');
    else storageDenied(foreignDelete, 'user deleted other avatar');
    // Also verify denied deletion actually preserved the public object.
    ok(await request(`/storage/v1/object/public/avatars/${avatarPaths[1]}`), 200, 'foreign delete removed avatar or public avatar unreadable');
    storageDenied(await upload(avatarPaths[0], other.token), 'foreign UUID upload accepted');
    ok(await upload(avatarPaths[0], user.token), 200, 'own avatar upload failed');
    ok(await upload(avatarPaths[0], user.token, png, 'image/png', 'PUT'), 200, 'own avatar update failed');
    const badMime = await upload(`${user.id}/${marker}.svg`, user.token, new TextEncoder().encode('<svg/>'), 'image/svg+xml');
    assert.ok([400,415,422].includes(badMime.status), 'SVG avatar accepted');
    const oversized = await upload(`${user.id}/${marker}-large.png`, user.token, new Uint8Array(2097153));
    assert.ok([400,413,422].includes(oversized.status), 'oversized avatar accepted');
    one(await request(rowRoute, 'DELETE', admin.token), 200, 'admin delete failed');
    const unlike = await request(`/rest/v1/likes?user_id=eq.${user.id}&target_id=eq.${marker}`, 'DELETE', user.token);
    one(unlike, 200, 'unlike failed');
    one(await request(`/rest/v1/follows?follower_id=eq.${user.id}&target_id=eq.${admin.id}`, 'DELETE', user.token), 200, 'unfollow failed');
  } catch (error) { failure = error; }
  finally {
    async function cleanup(route, token, body) {
      try { const r = await request(route, 'DELETE', token, body); assert.ok([200,204].includes(r.status)); }
      catch { cleanupErrors.push(route.split('?')[0]); }
    }
    await cleanup(commentsRoute, admin.token);
    await cleanup(`/rest/v1/comments?post_slug=eq.${marker}-other`, admin.token);
    for (const actor of [user, other]) {
      await cleanup(`/rest/v1/likes?user_id=eq.${actor.id}&target_id=eq.${marker}`, actor.token);
      await cleanup(`/rest/v1/follows?follower_id=eq.${actor.id}&target_id=eq.${admin.id}`, actor.token);
      await cleanup('/storage/v1/object/avatars', actor.token, {prefixes:[`${actor.id}/${marker}.png`,`${actor.id}/${marker}.svg`,`${actor.id}/${marker}-large.png`]});
    }
    if (roleAttempted) {
      const r = await request(`/rest/v1/user_roles?user_id=eq.${user.id}`, 'GET', admin.token);
      if (r.status !== 200 || r.data?.[0]?.role !== 'user') {
        const reset = await request(`/rest/v1/user_roles?user_id=eq.${user.id}`, 'PATCH', user.token, {role:'user'});
        if (reset.status !== 200 || reset.data?.[0]?.role !== 'user') cleanupErrors.push('test user role: restore user in Dashboard');
      }
    }
    // End test sessions even on a failed assertion. No refresh tokens are retained.
    for (const actor of [user, other, admin]) {
      try { await request('/auth/v1/logout?scope=local', 'POST', actor.token); } catch { cleanupErrors.push('test session logout'); }
    }
  }
  if (cleanupErrors.length) console.error('Cleanup needs inspection:', [...new Set(cleanupErrors)].join(', '), 'test marker:', marker);
  if (failure) throw failure;
  assert.equal(cleanupErrors.length, 0, 'test cleanup failed');
  console.log('Live RLS passed: seeded identity privacy, count RPC limits, profile/role/author isolation, comment moderation/replies, likes/follows uniqueness and removal, avatar ownership/type/size/public access.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAcceptance().catch((error) => {
    // Do not dump request objects, credentials, tokens, or server response bodies.
    console.error(error.message); process.exitCode = 1;
  });
}
