(function () {
  'use strict';
  var auth = window.BlogAuth;
  function db() { return auth.client(); }
  function value(result) { if (result.error) throw result.error; return result.data; }
  function requireLogin() { return auth.requireUser().id; }
  function normalizeComment(row, profiles) {
    var profile = row.user_id && profiles[row.user_id];
    return {
      id: row.id, slug: row.post_slug, parentId: row.parent_id,
      nick: row.legacy_author_name || (profile && (profile.display_name || profile.username)) || '已注销用户',
      avatar: profile && profile.avatar_url,
      time: row.created_at.slice(0, 10), content: row.content, status: row.status,
      own: !!(auth.user() && row.user_id === auth.user().id)
    };
  }
  async function listComments(slug) {
    await auth.ready();
    if (!auth.configured()) return ((window.SITE_COMMENTS || {})[slug] || []).map(function (item) {
      return { id: item.id, slug: slug, parentId: item.parentId, nick: item.nick, time: item.time, content: item.content, status: 'approved', legacy: true };
    });
    var rows = value(await db().from('comments').select('*').eq('post_slug', slug).order('created_at', { ascending: true }));
    var ids = [...new Set(rows.map(function (row) { return row.user_id; }).filter(Boolean))];
    var profiles = {};
    if (ids.length) value(await db().from('profiles').select('id,username,display_name,avatar_url').in('id', ids)).forEach(function (p) { profiles[p.id] = p; });
    return rows.filter(function (row) { return row.status !== 'rejected'; }).map(function (row) { return normalizeComment(row, profiles); });
  }
  async function addComment(slug, content, parentId) {
    await auth.ready();
    var id = requireLogin();
    return value(await db().from('comments').insert({ post_slug: slug, content: content, parent_id: parentId || null, user_id: id, status: 'pending' }).select().single());
  }
  async function listModeration() {
    await auth.ready(); auth.requireAdmin();
    return value(await db().from('comments').select('*').order('created_at', { ascending: false }));
  }
  async function moderateComment(id, status) {
    await auth.ready(); auth.requireAdmin();
    if (!['approved', 'rejected'].includes(status)) throw new Error('无效审核状态。');
    value(await db().from('comments').update({ status: status }).eq('id', id));
  }
  async function deleteComment(id) {
    await auth.ready(); auth.requireAdmin();
    value(await db().from('comments').delete().eq('id', id));
  }
  async function likes(type, ids) {
    await auth.ready();
    if (!auth.configured() || !ids.length) return {};
    var rows = value(await db().from('likes').select('user_id,target_id').eq('target_type', type).in('target_id', ids));
    var out = {};
    rows.forEach(function (row) {
      if (!out[row.target_id]) out[row.target_id] = { count: 0, liked: false };
      out[row.target_id].count++;
      if (auth.user() && row.user_id === auth.user().id) out[row.target_id].liked = true;
    });
    return out;
  }
  async function toggleLike(type, id) {
    await auth.ready();
    var userId = requireLogin();
    var existing = value(await db().from('likes').select('user_id').eq('user_id', userId).eq('target_type', type).eq('target_id', id));
    if (existing.length) value(await db().from('likes').delete().eq('user_id', userId).eq('target_type', type).eq('target_id', id));
    else value(await db().from('likes').insert({ user_id: userId, target_type: type, target_id: id }));
    return !existing.length;
  }
  async function getProfile(id) {
    await auth.ready();
    if (!auth.configured()) return null;
    return value(await db().from('profiles').select('*').eq('id', id).maybeSingle());
  }
  async function saveProfile(changes) {
    await auth.ready();
    var id = requireLogin();
    return value(await db().from('profiles').update(changes).eq('id', id).select().single());
  }
  async function uploadAvatar(file) {
    await auth.ready();
    var id = requireLogin();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('头像须为 2 MB 内的 JPG、PNG 或 WebP。');
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    var path = id + '/avatar-' + Date.now() + '.' + ext;
    value(await db().storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false }));
    var url = db().storage.from('avatars').getPublicUrl(path).data.publicUrl;
    await saveProfile({ avatar_url: url });
    return url;
  }
  async function following(targetId) {
    await auth.ready();
    if (!auth.user()) return false;
    return value(await db().from('follows').select('follower_id').eq('follower_id', auth.user().id).eq('target_id', targetId)).length > 0;
  }
  async function toggleFollow(targetId) {
    await auth.ready();
    var id = requireLogin();
    if (id === targetId) throw new Error('不能关注自己。');
    var has = await following(targetId);
    if (has) value(await db().from('follows').delete().eq('follower_id', id).eq('target_id', targetId));
    else value(await db().from('follows').insert({ follower_id: id, target_id: targetId }));
    return !has;
  }
  window.BlogData = { listComments: listComments, addComment: addComment, listModeration: listModeration,
    moderateComment: moderateComment, deleteComment: deleteComment, likes: likes, toggleLike: toggleLike,
    getProfile: getProfile, saveProfile: saveProfile, uploadAvatar: uploadAvatar, following: following, toggleFollow: toggleFollow };
})();
