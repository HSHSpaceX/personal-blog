// Optional live RLS integration test. Run only against a configured test project with three test users.
// Credentials come from environment variables and are never printed or written to files.
import assert from 'node:assert/strict';
const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'TEST_USER_EMAIL', 'TEST_USER_PASSWORD', 'TEST_OTHER_EMAIL', 'TEST_OTHER_PASSWORD', 'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) { console.error(`Missing ${missing.join(', ')}; live RLS test was not run.`); process.exit(2); }
const base = process.env.SUPABASE_URL.replace(/\/$/, '');
assert.match(base, /^https:\/\//);
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
async function request(route, method, token, body, extra = {}) {
  const response = await fetch(base + route, { method, headers: {
    apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json',
    Prefer: 'return=representation', ...extra
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
async function login(email, password) {
  const response = await request('/auth/v1/token?grant_type=password', 'POST', null, { email, password });
  assert.equal(response.status, 200, 'test account login failed');
  return response.data;
}
const user = await login(process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD);
const other = await login(process.env.TEST_OTHER_EMAIL, process.env.TEST_OTHER_PASSWORD);
const admin = await login(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
const userId = user.user.id, otherId = other.user.id;
const random = crypto.randomUUID();
let commentId = null;
try {
  let result = await request('/rest/v1/comments', 'POST', null, { post_slug: 'about', user_id: userId, content: 'RLS test ' + random, status: 'pending' });
  assert.ok(result.status === 401 || result.status === 403, 'anonymous comment insert must fail');
  result = await request(`/rest/v1/profiles?id=eq.${otherId}`, 'PATCH', user.access_token, { bio: 'RLS test ' + random });
  assert.ok(result.status === 403 || (result.status === 200 && result.data.length === 0), 'user changed another profile');
  result = await request(`/rest/v1/user_roles?user_id=eq.${userId}`, 'PATCH', user.access_token, { role: 'admin' });
  assert.ok(result.status === 401 || result.status === 403 || (result.status === 200 && result.data.length === 0), 'user escalated role');
  result = await request('/rest/v1/comments', 'POST', user.access_token, { post_slug: 'about', user_id: otherId, content: 'forged ' + random, status: 'pending' });
  assert.ok(result.status === 403 || result.status === 401, 'user forged comment author');
  result = await request('/rest/v1/comments', 'POST', user.access_token, { post_slug: 'about', user_id: userId, content: 'RLS test ' + random, status: 'pending' });
  assert.equal(result.status, 201, 'user cannot create own pending comment');
  commentId = result.data[0].id;
  result = await request(`/rest/v1/comments?id=eq.${commentId}`, 'GET', null);
  assert.equal(result.data.length, 0, 'anonymous user read pending comment');
  result = await request(`/rest/v1/comments?id=eq.${commentId}`, 'PATCH', user.access_token, { status: 'approved' });
  assert.ok(result.status === 403 || (result.status === 200 && result.data.length === 0), 'user approved own comment');
  result = await request(`/rest/v1/comments?id=eq.${commentId}`, 'PATCH', admin.access_token, { status: 'approved' });
  assert.equal(result.status, 200, 'admin moderation failed');
  assert.equal(result.data.length, 1, 'admin did not update comment');
  result = await request(`/rest/v1/comments?id=eq.${commentId}`, 'GET', null);
  assert.equal(result.data.length, 1, 'approved comment not publicly visible');
  const like = { user_id: userId, target_type: 'post', target_id: 'rls-test-' + random };
  result = await request('/rest/v1/likes', 'POST', user.access_token, like);
  assert.equal(result.status, 201, 'first like failed');
  result = await request('/rest/v1/likes', 'POST', user.access_token, like);
  assert.equal(result.status, 409, 'duplicate like was accepted');
  console.log('Live RLS passed: anonymous write, profile/role/author isolation, moderation, visibility, duplicate like.');
} finally {
  if (commentId) await request(`/rest/v1/comments?id=eq.${commentId}`, 'DELETE', admin.access_token);
  await request(`/rest/v1/likes?user_id=eq.${userId}&target_id=eq.rls-test-${random}`, 'DELETE', user.access_token);
}
