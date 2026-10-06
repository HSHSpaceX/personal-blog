import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedActors, asActor, actors, modulePath } from './helpers/postgres.mjs';
const { user, other, admin, admin2 } = actors;
const options = { skip: !modulePath && 'Set PGLITE_MODULE to execute real PostgreSQL/RLS checks.' };

function checks(db) {
  let assertions = 0;
  const run = (id, sql, args) => asActor(db, id ? 'authenticated' : 'anon', id, sql, args);
  const rows = async (id, sql, args = [], count = 0) => {
    const result = await run(id, sql, args);
    assert.equal(result.rows.length, count); assertions++; return result.rows;
  };
  const denied = async (id, sql, args = [], pattern = /permission denied|row-level security|Content unavailable|Admin required/) => {
    await assert.rejects(run(id, sql, args), pattern); assertions++;
  };
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const item = async (id, type, slug) => (await rows(id, 'select public.community_create_item($1,$2) as id', [type, slug], 1))[0].id;
  const revision = async (id, itemId, title) => (await rows(id, 'select public.community_save_revision($1,$2,$3) as id', [itemId, title, {text: title}], 1))[0].id;
  const submit = (id, revisionId) => run(id, 'select public.community_submit_revision($1)', [revisionId]);
  const review = (id, revisionId, decision, reason = null) => run(id, 'select public.community_review_revision($1,$2,$3)', [revisionId, decision, reason]);
  return { run, rows, denied, equal, item, revision, submit, review, report: label => console.log(`${label}: ${assertions} assertions passed.`) };
}

test('Round 1 migration history: private UUIDs, immutable revisions, atomic publication/rejection, roles and policy snapshots', options, async () => {
  const db = await createDatabase({through:'202610060002_social_notifications.sql'});
  try {
    await seedActors(db);
    const c = checks(db);
    c.equal((await c.run(user, 'select public.is_admin() as admin')).rows[0].admin, false);
    for (const id of [admin, admin2]) c.equal((await c.run(id, 'select public.is_admin() as admin')).rows[0].admin, true);
    for (const id of [user, admin]) await c.denied(id, "update public.user_roles set role='admin' where user_id=$1", [user]);
    await c.denied(user, "insert into public.user_roles(user_id,role) values ($1,'admin')", [other]);
    await c.denied(null, "select public.community_create_item('article','guest')");
    await c.denied(user, 'select public.community_set_review_policy($1,$2)', ['article', false]);
    await c.denied(user, "insert into public.content_items(author_id,content_type,slug) values ($1,'article','forged')", [other]);

    const itemId = await c.item(user, 'article', 'community-test');
    const v1 = await c.revision(user, itemId, 'Published version one');
    await c.rows(user, 'select * from public.content_items where id=$1', [itemId], 1);
    await c.rows(null, 'select * from public.content_items where id=$1', [itemId], 0);
    await c.rows(other, 'select * from public.content_items where id=$1', [itemId], 0);
    for (const id of [null, other]) await c.rows(id, 'select * from public.content_revisions where id=$1', [v1], 0);
    for (const id of [user, admin, admin2]) await c.rows(id, 'select * from public.content_revisions where id=$1', [v1], 1);
    await c.denied(other, 'select public.community_save_revision($1,$2,$3)', [itemId, 'Attack', {}]);
    await c.denied(admin, 'select public.community_save_revision($1,$2,$3)', [itemId, 'Not the author', {}]);
    await c.denied(other, 'select public.community_submit_revision($1)', [v1]);
    await c.denied(user, 'select public.community_review_revision($1,$2,$3)', [v1, 'approved', null]);
    for (const id of [user, admin]) {
      await c.denied(id, "update public.content_revisions set body='{}',status='approved' where id=$1", [v1]);
      await c.denied(id, 'update public.content_items set author_id=$1,published_revision_id=$2 where id=$3', [other, v1, itemId]);
      await c.denied(id, 'delete from public.content_items where id=$1', [itemId]);
      await c.denied(id, 'truncate public.content_revisions');
    }
    await c.submit(user, v1);
    await c.rows(other, 'select * from public.content_reviews where revision_id=$1', [v1], 0);
    await c.denied(null, 'select * from public.content_reviews where revision_id=$1', [v1]);
    for (const id of [user, admin, admin2]) await c.rows(id, 'select * from public.content_reviews where revision_id=$1', [v1], 1);
    await c.denied(user, 'update public.content_reviews set reviewer_id=$1,status=$2 where revision_id=$3', [user, 'approved', v1]);
    await c.review(admin2, v1, 'approved');
    c.equal((await c.rows(null, 'select title,body from public.content_revisions where id=$1', [v1], 1))[0], {title:'Published version one',body:{text:'Published version one'}});
    await c.rows(other, 'select * from public.content_reviews where revision_id=$1', [v1], 0);
    await c.denied(admin, 'select public.community_review_revision($1,$2,$3)', [v1, 'rejected', 'Rewrite history'], /Only a pending/);

    const v2 = await c.revision(user, itemId, 'Private edited version');
    await c.submit(user, v2);
    const future = await c.revision(user, itemId, 'Another draft while review is pending');
    await c.denied(user, 'select public.community_submit_revision($1)', [future], /already has a pending/);
    for (const id of [null, other]) {
      await c.rows(id, 'select * from public.content_revisions where id=$1', [v2], 0);
      c.equal((await c.rows(id, 'select published_revision_id from public.content_items where id=$1', [itemId], 1))[0].published_revision_id, v1);
      c.equal((await c.rows(id, 'select id from public.content_revisions where item_id=$1', [itemId], 1))[0].id, v1);
    }
    await c.denied(admin, 'select public.community_review_revision($1,$2,$3)', [v2, 'rejected', null], /Invalid review/);
    await c.denied(admin, 'select public.community_review_revision($1,$2,$3)', [v2, 'rejected', '  '], /Invalid review/);
    await c.denied(admin, 'select public.community_review_revision($1,$2,$3)', [v2, 'approved', 'Unexpected reason'], /Invalid review/);
    await c.review(admin, v2, 'rejected', 'Please verify the source');
    c.equal((await c.rows(user, 'select status,rejection_reason from public.content_revisions where id=$1', [v2], 1))[0], {status:'rejected',rejection_reason:'Please verify the source'});
    c.equal((await c.rows(user, 'select rejection_reason from public.content_reviews where revision_id=$1', [v2], 1))[0].rejection_reason, 'Please verify the source');
    c.equal((await c.rows(null, 'select published_revision_id from public.content_items where id=$1', [itemId], 1))[0].published_revision_id, v1);
    await c.rows(other, 'select * from public.content_revisions where id=$1', [v2], 0);
    await c.rows(other, 'select * from public.content_reviews where revision_id=$1', [v2], 0);
    await c.denied(user, 'select public.community_submit_revision($1)', [v2], /Only a newer draft/);

    const v4 = await c.revision(user, itemId, 'Published version four');
    await c.submit(user, v4);
    await c.run(admin, 'select public.community_set_review_policy($1,$2)', ['article', false]);
    c.equal((await c.rows(user, 'select policy_snapshot from public.content_reviews where revision_id=$1', [v4], 1))[0].policy_snapshot.requires_review, true);
    await c.review(admin, v4, 'approved');
    for (const id of [null, other]) {
      c.equal((await c.rows(id, 'select id from public.content_revisions where item_id=$1', [itemId], 1))[0].id, v4);
      await c.rows(id, 'select * from public.content_revisions where id=$1', [v1], 0);
    }
    await c.denied(user, 'select public.community_submit_revision($1)', [future], /Only a newer draft/);
    await c.rows(user, 'select * from public.content_revisions where item_id=$1', [itemId], 4);
    await c.rows(user, 'select * from public.review_policies', [], 0);
    await c.rows(admin2, 'select * from public.review_policies', [], 3);
    await c.denied(user, 'update public.review_policies set requires_review=false');
    await c.denied(user, "select public.community_create_item('unsupported','invalid')", [], /check constraint/);
    await c.denied(user, 'select public.community_save_revision($1,$2,$3)', [itemId, 'Bad body', []], /check constraint/);
    await c.denied(user, 'select public.community_save_revision($1,$2,$3)', [itemId, '', {}], /check constraint/);

    // Admins can author and submit exactly like users; another admin can review them.
    const adminItem = await c.item(admin, 'album', 'admin-album');
    const adminVersion = await c.revision(admin, adminItem, 'Admin contribution');
    await c.submit(admin, adminVersion);
    await c.review(admin2, adminVersion, 'approved');
    await c.rows(null, 'select * from public.content_revisions where id=$1', [adminVersion], 1);
    // Explicitly disabled review policy auto-publishes, recording its snapshot.
    const autoItem = await c.item(user, 'article', 'policy-published');
    const autoVersion = await c.revision(user, autoItem, 'Automatic policy publication');
    await c.submit(user, autoVersion);
    await c.rows(null, 'select * from public.content_revisions where id=$1', [autoVersion], 1);
    c.equal((await c.rows(user, 'select status,decision_source,reviewer_id from public.content_reviews where revision_id=$1', [autoVersion], 1))[0], {status:'approved',decision_source:'policy',reviewer_id:null});
    c.equal((await db.query('select count(*)::int as count from public.notifications')).rows[0].count, 0);
    // Account deletion must not break the circular publication FK; other
    // authors' review history survives reviewer deletion with a null identity.
    await db.query('delete from auth.users where id=$1', [admin2]);
    c.equal((await c.rows(user, 'select reviewer_id from public.content_reviews where revision_id=$1', [v1], 1))[0].reviewer_id, null);
    await db.query('delete from auth.users where id=$1', [user]);
    await c.rows(null, 'select * from public.content_items where id=$1', [itemId], 0);
    await c.rows(admin, 'select * from public.content_revisions where id=$1', [v4], 0);
    await c.rows(null, 'select * from public.content_revisions where id=$1', [adminVersion], 1);
    c.report('Community version/role/privacy');
  } finally { await db.close(); }
});

test('Round 1 migration history: private asset registry, owner-only mutation and least privilege', options, async () => {
  const db = await createDatabase({through:'202610060002_social_notifications.sql'});
  try {
    await seedActors(db); const c = checks(db);
    const sql = "insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes) values ($1,$2,'image.png','image/png',12) returning id";
    const asset = (await c.rows(user, sql, [user, user+'/image.png'], 1))[0].id;
    await c.rows(user, 'select * from public.user_assets where id=$1', [asset], 1);
    await c.rows(other, 'select * from public.user_assets where id=$1', [asset], 0);
    await c.rows(admin, 'select * from public.user_assets where id=$1', [asset], 1);
    await c.denied(null, 'select * from public.user_assets where id=$1', [asset]);
    await c.denied(user, sql, [other, other+'/forged.png']);
    for (const path of [other+'/bad.png', user+'/../bad.png', user+'/./bad.png', user+'/']) {
      await c.denied(user, sql, [user, path], /check constraint/);
    }
    await c.rows(other, "update public.user_assets set original_name='stolen.png' where id=$1 returning id", [asset], 0);
    await c.rows(admin, "update public.user_assets set original_name='not-mine.png' where id=$1 returning id", [asset], 0);
    await c.rows(user, "update public.user_assets set original_name='renamed.png' where id=$1 returning id", [asset], 1);
    for (const field of ['id', 'owner_id']) await c.denied(user, `update public.user_assets set ${field}=$1 where id=$2`, [other,asset]);
    await c.denied(user, "update public.user_assets set object_path='public/leak.png' where id=$1", [asset]);
    await c.rows(other, 'delete from public.user_assets where id=$1 returning id', [asset], 0);
    await c.rows(user, 'delete from public.user_assets where id=$1 returning id', [asset], 1);
    await c.rows(admin, sql, [admin, admin+'/admin.png'], 1);
    for (const table of ['content_items','content_revisions','content_reviews','review_policies','user_assets','notifications']) {
      await c.denied(user, `truncate public.${table}`);
      c.equal((await db.query("select has_table_privilege('authenticated',$1,'TRIGGER') as allowed", ['public.'+table])).rows[0].allowed, false);
    }
    for (const signature of ['community_create_item(text,text)','community_save_revision(uuid,text,jsonb)', 'community_submit_revision(uuid)', 'community_review_revision(uuid,text,text)', 'community_set_review_policy(text,boolean)']) {
      c.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') as allowed", ['public.'+signature])).rows[0].allowed, false);
    }
    c.report('Community assets/grants');
  } finally { await db.close(); }
});

test('Social notifications: user and multiple admins retain all social powers, no self events or private reply leaks', options, async () => {
  const db = await createDatabase();
  try {
    await seedActors(db); const c = checks(db);
    const comment = async (id, text, parent = null, status = 'pending') => (await c.rows(id,
      "insert into public.comments(post_slug,user_id,content,parent_id,status) values ('social',$1,$2,$3,$4) returning id", [id,text,parent,status],1))[0].id;
    const notifyCount = async (id, type) => (await c.rows(id,'select id from public.notifications where type=$1',[type],
      (await db.query('select count(*)::int as n from public.notifications where user_id=$1 and type=$2',[id,type])).rows[0].n)).length;
    const userComment = await comment(user,'User comment');
    await c.run(admin,'update public.comments set status=$1 where id=$2',['approved',userComment]);
    c.equal(await notifyCount(user,'comment_approved'),1);
    const adminComment = await comment(admin,'Admin social comment',null,'approved');
    const adminPending = await comment(admin,'Admin can also submit pending');
    await c.run(admin2,'update public.comments set status=$1 where id=$2',['approved',adminPending]);
    c.equal(await notifyCount(admin,'comment_approved'),1);
    await c.run(user,"insert into public.likes(user_id,target_type,target_id) values ($1,'comment',$2)",[user,adminComment]);
    await c.run(admin,"insert into public.likes(user_id,target_type,target_id) values ($1,'comment',$2)",[admin,userComment]);
    await c.run(admin2,"insert into public.likes(user_id,target_type,target_id) values ($1,'comment',$2)",[admin2,adminComment]);
    c.equal(await notifyCount(admin,'comment_like'),2);
    c.equal(await notifyCount(user,'comment_like'),1);
    for (const [sender,recipient] of [[user,admin],[admin,user],[admin2,admin]]) {
      await c.run(sender,'insert into public.follows(follower_id,target_id) values ($1,$2)',[sender,recipient]);
    }
    c.equal(await notifyCount(admin,'follow'),2);
    c.equal(await notifyCount(user,'follow'),1);
    const reply = await comment(user,'Pending reply to admin',adminComment);
    c.equal(await notifyCount(admin,'comment_reply'),0);
    await c.run(admin2,'update public.comments set status=$1 where id=$2',['approved',reply]);
    c.equal(await notifyCount(admin,'comment_reply'),1);
    await c.run(admin2,'update public.comments set status=$1 where id=$2',['approved',reply]);
    c.equal(await notifyCount(admin,'comment_reply'),1);
    await comment(admin,'Admin replies to user',userComment,'approved');
    c.equal(await notifyCount(user,'comment_reply'),1);
    await comment(admin2,'Admin replies to another admin',adminComment,'approved');
    c.equal(await notifyCount(admin,'comment_reply'),2);
    await comment(admin,'Self reply',adminComment,'approved');
    await c.run(admin,"insert into public.likes(user_id,target_type,target_id) values ($1,'comment',$2)",[admin,adminComment]);
    const selfPending = await comment(admin,'Self approval');
    await c.run(admin,'update public.comments set status=$1 where id=$2',['approved',selfPending]);
    c.equal((await db.query('select count(*)::int as n from public.notifications where actor_id=user_id')).rows[0].n,0);
    c.equal(await notifyCount(admin,'comment_reply'),2);
    c.equal(await notifyCount(admin,'comment_like'),2);
    c.equal(await notifyCount(admin,'comment_approved'),1);
    const rejected = await comment(user,'Rejected private reply',adminComment);
    await c.run(admin,'update public.comments set status=$1 where id=$2',['rejected',rejected]);
    c.equal(await notifyCount(admin,'comment_reply'),2);
    await c.denied(null,'select * from public.notifications');
    await c.rows(admin,'select * from public.notifications where user_id=$1',[user],0);
    await c.rows(other,'select * from public.notifications',[],0);
    await c.denied(user,"insert into public.notifications(user_id,type,title) values ($1,'follow','Forged')",[admin]);
    await c.denied(admin,"update public.notifications set title='Forged'");
    const own = await c.run(admin,'update public.notifications set read=true where user_id=$1 returning id',[admin]);
    assert.ok(own.rows.length>0);
    await c.run(admin,"update public.profiles set bio='Admin social profile' where id=$1",[admin]);
    c.equal((await c.rows(admin,'select bio from public.profiles where id=$1',[admin],1))[0].bio,'Admin social profile');
    await c.rows(admin,'delete from public.likes where user_id=$1 and target_id=$2 returning target_id',[admin,userComment],1);
    await c.rows(admin,'delete from public.follows where follower_id=$1 and target_id=$2 returning target_id',[admin,user],1);
    await c.denied(admin,'insert into public.follows(follower_id,target_id) values ($1,$1)',[admin],/check constraint/);
    c.report('Social notifications/admin capabilities');
  } finally { await db.close(); }
});
