// Optional local PostgreSQL execution, isolated from real Supabase credentials.
// PGLITE_MODULE=file:///tmp/.../package/dist/index.js node tests/rls-postgres.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, modulePath } from './helpers/postgres.mjs';
test('migrations enforce permissions in PostgreSQL (PGlite)', { skip: !modulePath && 'Set PGLITE_MODULE; live Supabase acceptance is a separate check.' }, async () => {
  const db = await createDatabase();
  const user = '00000001-0000-4000-8000-000000000001';
  const other = '00000002-0000-4000-8000-000000000002';
  const admin = '00000003-0000-4000-8000-000000000003';
  let assertions = 0;
  async function actor(role, id, sql) {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id || '']);
      return await db.query(sql);
    } finally { await db.exec('rollback'); }
  }
  async function denied(role, id, sql, pattern = /permission denied|row-level security/) {
    await assert.rejects(actor(role, id, sql), pattern); assertions++;
  }
  async function rows(role, id, sql, count) {
    assert.equal((await actor(role, id, sql)).rows.length, count); assertions++;
  }
  try {
    await db.exec(`insert into auth.users(id,raw_user_meta_data) values
      ('${user}','{"role":"admin"}'), ('${other}','{}'), ('${admin}','{}');
      update public.user_roles set role='admin' where user_id='${admin}';
      insert into public.comments(id,post_slug,user_id,content,status) values
      ('10000000-0000-4000-8000-000000000001','audit','${other}','pending','pending'),
      ('10000000-0000-4000-8000-000000000002','audit','${other}','approved','approved');
      insert into public.likes(user_id,target_type,target_id) values ('${other}','post','audit');
      insert into public.follows(follower_id,target_id) values ('${other}','${admin}');
      insert into storage.objects(bucket_id,name) values ('avatars','${other}/audit.png');`);
    assert.equal((await db.query(`select role from public.user_roles where user_id='${user}'`)).rows[0].role, 'user'); assertions++;
    for (const table of ['profiles', 'user_roles', 'comments', 'likes', 'follows']) {
      await denied('anon', null, `insert into public.${table} default values`, /permission denied/);
      await denied('authenticated', user, `truncate public.${table}`, /permission denied/);
    }
    for (const table of ['likes', 'follows', 'user_roles']) await denied('anon', null, `select * from public.${table}`, /permission denied/);
    await rows('authenticated', user, 'select * from public.likes', 0);
    await rows('authenticated', user, 'select * from public.follows', 0);
    await rows('authenticated', other, 'select * from public.likes', 1);
    await rows('authenticated', other, 'select * from public.follows', 1);
    await rows('authenticated', user, `update public.profiles set bio='attack' where id='${other}' returning id`, 0);
    await rows('authenticated', user, `update public.profiles set bio='own' where id='${user}' returning id`, 1);
    await denied('authenticated', user, `update public.profiles set id='${other}' where id='${user}'`);
    await denied('authenticated', user, `update public.user_roles set role='admin' where user_id='${user}'`);
    await denied('authenticated', admin, `update public.user_roles set role='admin' where user_id='${user}'`);
    const pending = '10000000-0000-4000-8000-000000000001', approved = '10000000-0000-4000-8000-000000000002';
    await rows('anon', null, 'select * from public.comments', 1);
    await rows('authenticated', user, `select * from public.comments where id='${pending}'`, 0);
    await rows('authenticated', other, `select * from public.comments where id='${pending}'`, 1);
    await denied('authenticated', user, `update public.comments set status='approved' where id='${pending}'`);
    await denied('authenticated', other, `update public.comments set status='approved' where id='${pending}'`);
    await rows('authenticated', user, `delete from public.comments where id='${approved}' returning id`, 0);
    await rows('authenticated', admin, `select public.community_moderate_comment('${pending}','approved',null)`, 1);
    await denied('authenticated', admin, `update public.comments set status='approved' where id='${pending}'`);
    await rows('authenticated', admin, `delete from public.comments where id='${pending}' returning id`, 1);
    await denied('authenticated', user, `insert into public.comments(post_slug,user_id,content) values('audit','${other}','forged')`);
    await denied('authenticated', user, `insert into public.comments(post_slug,user_id,content,status) values('audit','${user}','forged','approved')`);
    await denied('authenticated', user, `insert into public.comments(post_slug,user_id,content,created_at) values('audit','${user}','forged',now())`);
    await rows('authenticated', user, `insert into public.comments(post_slug,user_id,content,parent_id) values('audit','${user}','reply','${approved}') returning id`, 1);
    await denied('authenticated', user, `insert into public.comments(post_slug,user_id,content,parent_id) values('different','${user}','reply','${approved}')`, /Invalid reply target/);
    await denied('authenticated', user, `insert into public.comments(post_slug,user_id,content,parent_id) values('audit','${user}','reply','${pending}')`, /Invalid reply target/);
    await denied('authenticated', user, `insert into public.likes(user_id,target_type,target_id) values('${other}','post','forged')`);
    await denied('authenticated', other, `insert into public.likes(user_id,target_type,target_id) values('${other}','post','audit')`, /duplicate key/);
    await denied('authenticated', user, `insert into public.likes(user_id,target_type,target_id) values('${user}','comment','${pending}')`);
    await rows('authenticated', user, `insert into public.likes(user_id,target_type,target_id) values('${user}','comment','${approved}') returning target_id`, 1);
    await rows('authenticated', user, `delete from public.likes where user_id='${other}' returning target_id`, 0);
    await rows('authenticated', other, `delete from public.likes where user_id='${other}' returning target_id`, 1);
    await denied('authenticated', user, `insert into public.follows(follower_id,target_id) values('${other}','${user}')`);
    await denied('authenticated', other, `insert into public.follows(follower_id,target_id) values('${other}','${admin}')`, /duplicate key/);
    await denied('authenticated', user, `insert into public.follows(follower_id,target_id) values('${user}','${user}')`, /check constraint/);
    await rows('authenticated', user, `delete from public.follows where follower_id='${other}' returning target_id`, 0);
    await rows('authenticated', other, `delete from public.follows where follower_id='${other}' returning target_id`, 1);
    assert.deepEqual((await actor('anon', null, "select * from public.like_counts('post',array['audit'])")).rows, [{target_id:'audit',like_count:1}]); assertions++;
    assert.equal((await actor('anon', null, `select public.follower_count('${admin}') as count`)).rows[0].count, 1); assertions++;
    assert.equal((await actor('anon', null, `select public.user_like_count('${other}') as count`)).rows[0].count, 1); assertions++;
    for (const args of ["null,array['audit']", "'post',null", "'post',array_fill('x'::text,array[101])", "'post',array_fill('x'::text,array[2,60])", "'post',array[null]", "'post',array[repeat('x',161)]"]) {
      await denied('anon', null, `select * from public.like_counts(${args})`, /Invalid like count request/);
    }
    for (const name of ['on_auth_user_created', 'touch_updated_at', 'validate_comment_reply']) await denied('authenticated', user, `select public.${name}()`, /permission denied/);
    await rows('anon', null, 'select * from storage.objects', 1);
    await denied('anon', null, `insert into storage.objects(bucket_id,name) values('avatars','${user}/audit.png')`);
    await rows('authenticated', user, `insert into storage.objects(bucket_id,name) values('avatars','${user}/audit.png') returning id`, 1);
    await denied('authenticated', user, `insert into storage.objects(bucket_id,name) values('avatars','${other}/forged.png')`);
    await rows('authenticated', user, `update storage.objects set name='${user}/stolen.png' where name='${other}/audit.png' returning id`, 0);
    await rows('authenticated', user, `delete from storage.objects where name='${other}/audit.png' returning id`, 0);
    await denied('authenticated', other, `update storage.objects set name='${user}/moved.png' where name='${other}/audit.png'`);
    await rows('authenticated', other, `delete from storage.objects where name='${other}/audit.png' returning id`, 1);
    const functions = await db.query("select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosecdef");
    assert.deepEqual(functions.rows.map(fn => fn.proname).sort(), [
      'is_admin', 'is_admin_id', 'on_auth_user_created', 'like_counts', 'follower_count', 'user_like_count',
      'notify_comment_approved', 'notify_comment_reply', 'notify_comment_like', 'notify_follow',
      'community_create_item', 'community_save_revision', 'community_submit_revision',
      'community_review_revision', 'community_set_review_policy',
      'community_set_user_review_threshold', 'community_review_policy_status',
      'community_guard_registered_object', 'community_register_asset',
      'community_check_revision_assets', 'community_notify_review_result',
      'profile_followers','profile_following','following_count','community_public_target','community_comment_context',
      'profile_content','profile_recent_likes','community_like_target_visible','community_edit_comment',
      'community_review_comment_edit','community_moderate_comment','community_my_comments','community_notify_comment_edit',
      'community_assets_page','community_asset_references','community_rename_asset','community_orphan_assets',
      'community_prepare_asset_delete','community_prepare_orphan_delete','community_guard_orphan_delete','community_clear_delete_intent',
      'community_public_comments','notification_content_owner','notify_initial_comment_result','notification_unread_count','notification_mark_read',
      'dm_can_read_object','dm_guard_object','dm_clear_delete_intent','dm_get_or_create_thread','dm_threads','dm_messages',
      'dm_register_asset','dm_send_message','dm_mark_thread_read','dm_unread_count','dm_unsent_assets','dm_orphan_assets',
      'dm_prepare_asset_delete','dm_prepare_orphan_delete','notifications_page'
    ].sort());
    for (const fn of functions.rows) assert.ok(fn.proconfig.includes('search_path=""')); assertions++;
    // Auth deletion must preserve legacy content and clear FK identities even
    // when the account has a reply to its own pending comment.
    await db.exec(`begin; set local role authenticated;
      select set_config('request.jwt.claim.sub','${other}',true);
      insert into public.comments(post_slug,user_id,content,parent_id)
      values ('audit','${other}','pending reply','${pending}'); commit;`);
    await db.exec(`delete from auth.users where id='${other}'`);
    assert.equal((await db.query(`select count(*)::int as n from public.comments where user_id='${other}'`)).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.comments where content='pending reply' and user_id is null")).rows[0].n, 1);
    assertions++;
    console.log(`PostgreSQL RLS: ${assertions} permission/visibility/constraint assertions passed.`);
  } finally { await db.close(); }
});
