import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, seedActors, asActor, actors, modulePath } from './helpers/postgres.mjs';
const { user, other, admin } = actors;
const options = { skip: !modulePath && 'Set PGLITE_MODULE to execute real PostgreSQL/RLS checks.' };

test('owner deletion: direct draft removal, published article/album removal through review, RLS and audit', options, async () => {
  const db = await createDatabase();
  try {
    await seedActors(db);
    let assertions = 0;
    const run = (id, sql, args) => asActor(db, id ? 'authenticated' : 'anon', id, sql, args);
    const rows = async (id, sql, args = [], count = 0) => {
      const result = await run(id, sql, args);
      assert.equal(result.rows.length, count); assertions++; return result.rows;
    };
    const denied = async (id, sql, args = [], pattern = /permission denied|row-level security|Content unavailable|Admin required|Login required|22023|Invalid|cannot|Only|must|already|pending|存在|已|只有|不能|直接/) => {
      await assert.rejects(run(id, sql, args), pattern); assertions++;
    };
    const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
    const item = async (id, type, slug) => (await rows(id, 'select public.community_create_item($1,$2) as id', [type, slug], 1))[0].id;
    const revision = async (id, itemId, title) => (await rows(id, 'select public.community_save_revision($1,$2,$3) as id', [itemId, title, { text: title }], 1))[0].id;
    const submit = (id, revisionId) => run(id, 'select public.community_submit_revision($1)', [revisionId]);
    const approve = (id, revisionId) => run(id, 'select public.community_review_revision($1,$2,null)', [revisionId, 'approved']);

    // A. Direct deletion of an unpublished draft (album).
    const draftItem = await item(user, 'album', 'draft-' + randomUUID());
    await revision(user, draftItem, '草稿标题');
    await run(user, 'select public.community_delete_draft($1)', [draftItem]);
    const deleted = await rows(null, 'select deleted_at,published_revision_id from public.content_items where id=$1', [draftItem], 1);
    equal(deleted[0].published_revision_id, null);
    assert.ok(deleted[0].deleted_at); assertions++;
    // Soft-deleted drafts stay hidden but recoverable; no client DML, no resurrection.
    await denied(user, 'update public.content_items set deleted_at=null where id=$1', [draftItem]);
    await denied(user, 'select public.community_save_revision($1,$2,$3)', [draftItem, '复活', { text: 'x' }], /Deleted content/);
    await run(user, 'select public.community_delete_draft($1)', [draftItem]); // idempotent
    // Other accounts cannot delete or even target someone else's draft.
    const otherDraft = await item(other, 'article', 'other-' + randomUUID());
    await denied(user, 'select public.community_delete_draft($1)', [otherDraft], /unavailable|Login/);
    await denied(null, 'select public.community_delete_draft($1)', [otherDraft], /Login required/);

    // B. Published article: direct deletion refused; deletion request goes through review.
    const pubItem = await item(user, 'article', 'pub-' + randomUUID());
    const pubRev = await revision(user, pubItem, '已发布文章');
    await submit(user, pubRev);
    await approve(admin, pubRev);
    await denied(user, 'select public.community_delete_draft($1)', [pubItem], /不能直接删除/);
    // Wrong types and unpublished items cannot request deletion.
    const momItem = await item(user, 'moment', 'mom-' + randomUUID());
    const momRev = await revision(user, momItem, '动态正文');
    await submit(user, momRev);
    await approve(admin, momRev);
    await denied(user, 'select public.community_request_deletion($1,$2)', [momItem, '原因'], /只有文章和图册/);
    const unpub = await item(user, 'article', 'unpub-' + randomUUID());
    await revision(user, unpub, '未发布草稿');
    await denied(user, 'select public.community_request_deletion($1,$2)', [unpub, '原因'], /直接删除/);
    // Valid request, then a duplicate pending request is rejected.
    const reqId = (await rows(user, 'select public.community_request_deletion($1,$2) as id', [pubItem, '内容过时需要下线'], 1))[0].id;
    await denied(user, 'select public.community_request_deletion($1,$2)', [pubItem, '再次申请'], /duplicate key|唯一|unique/);
    // RLS: only requester and admin can see the request; no client DML.
    await rows(other, 'select * from public.content_deletion_requests where item_id=$1', [pubItem], 0);
    await rows(user, 'select * from public.content_deletion_requests where id=$1', [reqId], 1);
    await rows(admin, 'select * from public.content_deletion_requests where id=$1', [reqId], 1);
    await denied(user, 'insert into public.content_deletion_requests(item_id,requester_id) values($1,$1)', [pubItem]);
    await denied(user, "update public.content_deletion_requests set status='rejected' where id=$1", [reqId]);
    // Non-admin cannot decide; admin queue filters work.
    await denied(user, 'select public.community_review_deletion($1,$2,$3)', [reqId, 'approved', null], /Admin required/);
    await denied(user, 'select * from public.community_deletion_requests()', [], /Admin required/);
    const listed = await rows(admin, 'select * from public.community_deletion_requests($1,20,0)', ['pending'], 1);
    equal(listed[0].latest_public_title, '已发布文章');
    await rows(admin, 'select * from public.community_deletion_requests($1,20,0)', ['rejected'], 0);
    await denied(admin, 'select * from public.community_deletion_requests($1,0,0)', ['pending']);
    // Rejection without a reason is refused; with a reason the item stays public.
    await denied(admin, 'select public.community_review_deletion($1,$2,$3)', [reqId, 'rejected', null], /Invalid review decision/);
    await run(admin, 'select public.community_review_deletion($1,$2,$3)', [reqId, 'rejected', '仍需保留']);
    const stillPublic = await rows(null, 'select deleted_at,published_revision_id from public.content_items where id=$1', [pubItem], 1);
    equal(stillPublic[0].deleted_at, null);
    equal(stillPublic[0].published_revision_id, pubRev);
    const rejectedReq = await rows(null, 'select status,decision_reason,resolved_at from public.content_deletion_requests where id=$1', [reqId], 1);
    equal(rejectedReq[0].status, 'rejected');
    equal(rejectedReq[0].decision_reason, '仍需保留');
    assert.ok(rejectedReq[0].resolved_at); assertions++;
    // The author is notified and may re-request after a return.
    await rows(null, "select type from public.notifications where user_id=$1 and type='deletion_request_returned'", [user], 1);
    const req2 = (await rows(user, 'select public.community_request_deletion($1,$2) as id', [pubItem, '再次申请'], 1))[0].id;
    // A decided request cannot be reviewed twice.
    await denied(admin, 'select public.community_review_deletion($1,$2,$3)', [reqId, 'approved', null], /pending/);
    // Approval soft-deletes the item, notifies, and adds the tombstone for the publisher.
    await run(admin, 'select public.community_review_deletion($1,$2,$3)', [req2, 'approved', null]);
    const gone = await rows(null, 'select deleted_at,published_revision_id from public.content_items where id=$1', [pubItem], 1);
    assert.ok(gone[0].deleted_at); assertions++;
    equal(gone[0].published_revision_id, null);
    await rows(null, "select type from public.notifications where user_id=$1 and type='content_deleted'", [user], 1);
    const tomb = JSON.parse((await db.query('select * from public.community_deleted_export()')).rows[0].community_deleted_export);
    equal(tomb.some(row => row.id === pubItem && row.type === 'article'), true);
    // The public export no longer contains the approved article.
    const exportRows = await db.query("select (element->>'id')::text as id from jsonb_array_elements(public.community_publication_export_base()) t(element)");
    equal(exportRows.rows.some(row => row.id === pubItem), false);
    // The audit trail records the full request lifecycle in order.
    const audit = await rows(admin, 'select action from public.community_management_audit where item_id=$1 order by id', [pubItem]);
    equal(audit.map(row => row.action), ['review_approved', 'request_deletion', 'reject_deletion', 'request_deletion', 'approve_deletion']);

    // C. A pending revision blocks both deletion paths until resolved.
    const gated = await item(user, 'album', 'gated-' + randomUUID());
    const gatedRev = await revision(user, gated, '待审图册');
    await submit(user, gatedRev);
    await denied(user, 'select public.community_delete_draft($1)', [gated], /待审核/);
    const gatedPub = await item(user, 'article', 'gatedpub-' + randomUUID());
    const gatedPubRev = await revision(user, gatedPub, '待审文章');
    await submit(user, gatedPubRev);
    await approve(admin, gatedPubRev);
    const gatedEdit = await revision(user, gatedPub, '待审修改');
    await submit(user, gatedEdit);
    await denied(user, 'select public.community_request_deletion($1,$2)', [gatedPub, '原因'], /待审核/);
    await approve(admin, gatedEdit);
    const lateReq = (await rows(user, 'select public.community_request_deletion($1,$2) as id', [gatedPub, '原因'], 1))[0].id;
    await run(admin, 'select public.community_review_deletion($1,$2,$3)', [lateReq, 'approved', null]);
    await rows(null, 'select deleted_at from public.content_items where id=$1 and deleted_at is null', [gatedPub], 0);

    console.log('owner deletion: ' + assertions + ' assertions passed.');
  } finally { await db.close(); }
});
