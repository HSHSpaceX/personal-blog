import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const domModule = process.env.COMMUNITY_DOM_MODULE;
const options = { skip: !domModule && 'Set COMMUNITY_DOM_MODULE to run real DOM deletion controls.' };
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const user = randomUUID(), admin = randomUUID();
async function settle() { for (let i = 0; i < 15; i++) await new Promise(r => setImmediate(r)); }
async function dom() {
  const imported = await import(domModule), JSDOM = imported.JSDOM || imported.default.JSDOM;
  return new JSDOM(await read('account.html'), { url: 'https://blog.invalid/account.html', runScripts: 'outside-only' });
}
function item(type, published = false, deletions = []) {
  const it = { id: randomUUID(), author_id: user, content_type: type, slug: 's-' + randomUUID(), published_revision_id: null, content_deletion_requests: deletions, created_at: '2026-11-28T00:00:00Z' };
  const rev = { id: randomUUID(), title: '标题', status: published ? 'approved' : 'draft', content_items: it };
  it.published_revision_id = published ? rev.id : null;
  it.content_revisions = [rev];
  return it;
}
async function harness(role = 'user', items = []) {
  const d = await dom(), w = d.window;
  const actor = { id: role === 'admin' ? admin : user };
  const calls = [];
  const auth = { user: () => actor, isAdmin: () => role === 'admin', requireUser() { if (!actor) throw Error('Login required'); return actor; }, requireAdmin() { if (!this.isAdmin()) throw Error('Admin required'); return actor; } };
  const data = {
    async listItems() { return items.map(i => structuredClone(i)); },
    async listAssets() { return []; },
    async listReviews() { return []; },
    async deleteDraft(id) { calls.push(['deleteDraft', id]); const it = items.find(i => i.id === id); if (it) it.deleted_at = new Date().toISOString(); },
    async deleteMoment(id) { calls.push(['deleteMoment', id]); const it = items.find(i => i.id === id); if (it) it.deleted_at = new Date().toISOString(); },
    async requestDeletion(id, reason) { calls.push(['requestDeletion', id, reason]); const it = items.find(i => i.id === id); if (it) (it.content_deletion_requests = it.content_deletion_requests || []).push({ status: 'pending', created_at: new Date().toISOString() }); },
    errorMessage: e => e.message
  };
  w.BlogAuth = auth; w.CommunityData = data;
  w.confirm = () => true; w.prompt = () => '不再需要';
  w.setTimeout = () => 0; w.clearTimeout = () => {};
  w.eval(await read('js/categories.js')); w.eval(await read('js/community-schema.js')); w.eval(await read('js/resource-manager.js')); w.eval(await read('js/content-cards.js')); w.eval(await read('js/community-ui.js'));
  const $ = id => w.document.getElementById(id);
  return { d, w, $, calls, items, cards: () => Array.from($('communityItems').querySelectorAll('article')) };
}
const buttons = card => Array.from(card.querySelectorAll('button')).map(b => b.textContent);

async function reviewHarness(rows) {
  const d = await dom(), w = d.window;
  const actor = { id: admin };
  const calls = [];
  const plain = a => { const o = {}; for (const k in a) o[k] = a[k]; return o; };
  const auth = { ready: async () => {}, user: () => actor, isAdmin: () => true, requireUser() { return actor; }, requireAdmin() { return actor; }, client: () => ({ rpc: async (name, args) => { calls.push([name, plain(args)]); if (name === 'community_deletion_requests') return { data: rows.filter(r => args.p_status === 'all' || r.status === args.p_status).slice(args.p_offset, args.p_offset + args.p_limit) }; if (name === 'community_review_deletion') { const row = rows.find(r => r.id === args.p_request_id); row.status = args.p_decision; row.decision_reason = args.p_rejection_reason; return { data: null }; } return { data: 0 }; } }) };
  w.BlogAuth = auth;
  w.CommunityData = { errorMessage: e => e.message };
  w.BackendCapabilities = { requireUpgrade: async () => {} };
  w.confirm = () => true;
  w.setTimeout = () => 0; w.clearTimeout = () => {};
  w.eval(await read('js/community-schema.js')); w.eval(await read('js/review-center.js'));
  const $ = id => w.document.getElementById(id);
  return { d, w, $, calls, rows, settle: async () => { for (let i = 0; i < 15; i++) await new Promise(r => setImmediate(r)); } };
}

test('review center: deletion request queue renders, approve and return with required reason', options, async () => {
  const req1 = { id: randomUUID(), item_id: randomUUID(), requester_id: user, reason: '不再需要', status: 'pending', created_at: '2026-11-28T01:00:00Z', decision_reason: null, content_type: 'article', slug: 'pub-' + randomUUID(), draft_title: null, item_deleted: false, latest_public_title: '已发布文章', author: { username: 'test_user', display_name: '作者' } };
  const req2 = { id: randomUUID(), item_id: randomUUID(), requester_id: user, reason: '', status: 'pending', created_at: '2026-11-28T02:00:00Z', decision_reason: null, content_type: 'album', slug: 'alb-' + randomUUID(), draft_title: '图册名', item_deleted: false, latest_public_title: null, author: { username: 'test_user', display_name: '作者' } };
  const rows = [req1, req2];
  const h = await reviewHarness(rows);
  try {
    h.$('deletionRefresh').click(); await h.settle();
    assert.equal(h.$('deletionList').querySelectorAll('button').length, 2);
    assert.ok(h.$('deletionList').textContent.includes('删除申请'));
    assert.ok(h.$('deletionList').textContent.includes('已发布文章'));
    // Open the first detail; approving calls the review RPC with an empty rejection reason.
    h.$('deletionList').querySelectorAll('button')[0].click(); await h.settle();
    assert.equal(h.$('deletionDetail').hidden, false);
    assert.ok(h.$('deletionMeta').textContent.includes('文章'));
    assert.ok(h.$('deletionReason').textContent.includes('不再需要'));
    Array.from(h.$('deletionActions').querySelectorAll('button')).find(b => b.textContent === '批准删除').click(); await h.settle();
    assert.deepEqual(h.calls.find(c => c[0] === 'community_review_deletion')[1], { p_request_id: req1.id, p_decision: 'approved', p_rejection_reason: null });
    assert.equal(req1.status, 'approved');
    // The queue reloads under the pending filter: the decided row disappears.
    assert.equal(h.$('deletionList').querySelectorAll('button').length, 1);
    assert.ok(!h.$('deletionList').textContent.includes('已发布文章'));
    // The all filter shows the decided row with its outcome.
    h.$('deletionFilter').value = 'all';
    h.$('deletionRefresh').click(); await h.settle();
    assert.ok(h.$('deletionList').textContent.includes('已批准'));
    assert.equal(h.$('deletionList').querySelectorAll('button').length, 2);
    // Returning requires a reason before the RPC is allowed.
    Array.from(h.$('deletionList').querySelectorAll('button')).find(b => b.textContent.includes('图册')).click(); await h.settle();
    Array.from(h.$('deletionActions').querySelectorAll('button')).find(b => b.textContent === '退回申请').click(); await h.settle();
    assert.equal(h.calls.filter(c => c[0] === 'community_review_deletion').length, 1, 'no decision without a reason');
    assert.match(h.$('deletionLoadStatus').textContent, /退回申请必须填写原因/);
    h.$('deletionRejectReason').value = '内容仍需保留';
    Array.from(h.$('deletionActions').querySelectorAll('button')).find(b => b.textContent === '退回申请').click(); await h.settle();
    assert.deepEqual(h.calls.filter(c => c[0] === 'community_review_deletion')[1][1], { p_request_id: req2.id, p_decision: 'rejected', p_rejection_reason: '内容仍需保留' });
    assert.equal(req2.status, 'rejected');
  } finally { h.d.window.close(); }
});

test('account center: draft direct delete, published article/album deletion request, moment delete, pending/rejected states', options, async () => {
  const draft = item('article');
  const pubArt = item('article', true);
  const pubAlbum = item('album', true);
  const pubMom = item('moment', true);
  const pendingReq = item('album', true, [{ status: 'pending', created_at: '2026-11-28T01:00:00Z' }]);
  const returnedReq = item('article', true, [{ status: 'rejected', decision_reason: '仍需保留', created_at: '2026-11-28T01:00:00Z' }]);
  const h = await harness('user', [draft, pubArt, pubAlbum, pubMom, pendingReq, returnedReq]);
  try {
    await h.w.CommunityUI.refresh();
    const cardOf = id => h.cards().find(c => c.dataset.itemId === id);
    // Draft is deletable directly; published article/album go through a request; published moment deletes directly.
    assert.ok(buttons(cardOf(draft.id)).includes('删除草稿'));
    assert.ok(buttons(cardOf(pubArt.id)).includes('申请删除'));
    assert.ok(buttons(cardOf(pubAlbum.id)).includes('申请删除'));
    assert.ok(buttons(cardOf(pubMom.id)).includes('删除'));
    // A pending request replaces the button with a notice; a returned one shows the reason.
    assert.ok(cardOf(pendingReq.id).textContent.includes('删除申请审核中'));
    assert.equal(buttons(cardOf(pendingReq.id)).includes('申请删除'), false);
    assert.ok(cardOf(returnedReq.id).textContent.includes('删除申请被退回'));
    assert.ok(cardOf(returnedReq.id).textContent.includes('仍需保留'));
    // Direct draft deletion removes the item from the list.
    Array.from(cardOf(draft.id).querySelectorAll('button')).find(b => b.textContent === '删除草稿').click();
    await settle();
    assert.deepEqual(h.calls[0], ['deleteDraft', draft.id]);
    assert.equal(h.cards().some(c => c.dataset.itemId === draft.id), false);
    // A deletion request captures the prompted reason and then shows the pending notice.
    Array.from(cardOf(pubArt.id).querySelectorAll('button')).find(b => b.textContent === '申请删除').click();
    await settle();
    assert.deepEqual(h.calls[1], ['requestDeletion', pubArt.id, '不再需要']);
    assert.ok(cardOf(pubArt.id).textContent.includes('删除申请审核中'));
    assert.equal(buttons(cardOf(pubArt.id)).includes('申请删除'), false);
    // Published moment deletion keeps the existing moment semantics.
    Array.from(cardOf(pubMom.id).querySelectorAll('button')).find(b => b.textContent === '删除').click();
    await settle();
    assert.deepEqual(h.calls[2], ['deleteMoment', pubMom.id]);
    assert.equal(h.calls.some(c => c[0] === 'deleteDraft' && c[1] === pubMom.id), false);
  } finally { h.d.window.close(); }
});
