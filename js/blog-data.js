(function () {
  'use strict';
  var auth = window.BlogAuth;
  function db() { return auth.client(); }
  function Backend_FormatError(error) { return error && (['PGRST202','PGRST205','42883','42P01'].includes(error.code) || /Could not find (?:the function|the table).*schema cache/i.test(error.message||'')) ? '当前 Supabase 环境缺少所需表或 RPC，请站长核对项目配置、执行 migrations 并刷新 schema cache。操作未完成。' : error.message; }
  function value(result) { if (result.error) {var error=new Error(Backend_FormatError(result.error));error.code=result.error.code;throw error;} return result.data; }
  function requireLogin() { return auth.requireUser().id; }
  function normalizeComment(row, profiles) {
    var profile = row.user_id && profiles[row.user_id];
    return {
      id: row.id, slug: row.post_slug, parentId: row.parent_id,
      nick: row.legacy_author_name || (profile && (profile.display_name || profile.username)) || '已注销用户',
      username: profile && profile.username,
      profileId: row.user_id,
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
    var status = typeof auth.isAdmin === 'function' && auth.isAdmin() ? 'approved' : 'pending';
    return value(await db().from('comments').insert({ post_slug: slug, content: content, parent_id: parentId || null, user_id: id, status: status }).select().single());
  }
  async function listModeration() {
    await auth.ready(); auth.requireAdmin();
    return value(await db().from('comments').select('*').order('created_at', { ascending: false }));
  }

  async function listLatestComments(limit) {
    await auth.ready();
    if (!auth.configured()) return [];
    var size = Number(limit) || 9;
    var rows = value(await db().from('comments').select('*').eq('status', 'approved')
      .order('created_at', { ascending: false }).limit(size));
    var ids = [...new Set(rows.map(function (row) { return row.user_id; }).filter(Boolean))];
    var profiles = {};
    if (ids.length) value(await db().from('profiles').select('id,username,display_name,avatar_url').in('id', ids))
      .forEach(function (profile) { profiles[profile.id] = profile; });
    return rows.filter(function (row) { return row.status === 'approved'; })
      .map(function (row) { return normalizeComment(row, profiles); });
  }

  var personalGeneration = 0;
  if (typeof document !== 'undefined') document.addEventListener('blog-auth-change', function () { personalGeneration++; });
  async function personalRpc(name, args) {
    var actor = auth.user(), token = personalGeneration;
    await auth.ready();
    if (actor && (!auth.user() || actor.id !== auth.user().id || token !== personalGeneration)) throw Error('账号已变化。');
    actor = auth.requireUser(); token = personalGeneration;
    var result = value(await db().rpc(name, args));
    if (!auth.user() || auth.user().id !== actor.id || token !== personalGeneration) throw Error('账号已变化。');
    return result;
  }
  async function listNotifications(offset, limit) {
    await auth.ready(); if (!auth.user()) return [];
    return personalRpc('notifications_page', { p_limit: limit || 20, p_offset: offset || 0 });
  }
  async function notificationCount(includeDM) {
    await auth.ready(); if (!auth.user()) return 0;
    return Number(await personalRpc('notification_unread_count', { p_include_dm: includeDM !== false }));
  }
  async function markNotificationsRead(id) {
    await auth.ready(); if (!auth.user()) return;
    await personalRpc('notification_mark_read', { p_id: id || null });
  }
  async function dmUnreadCount() {
    await auth.ready(); if (!auth.user()) return 0;
    return Number(await personalRpc('dm_unread_count', {}));
  }
  async function messageUnreadCount() {
    var values = await Promise.all([notificationCount(false), dmUnreadCount()]);
    return values[0] + values[1];
  }
  async function moderateComment(id, status, reason, expectedContent) {
    await auth.ready(); auth.requireAdmin();
    if (!['approved', 'rejected'].includes(status)) throw new Error('无效审核状态。');
    value(await db().rpc('community_moderate_comment',{p_comment_id:id,p_decision:status,p_rejection_reason:reason||null,p_expected_content:expectedContent===undefined?null:expectedContent}));
  }
  async function deleteComment(id) {
    await auth.ready(); auth.requireAdmin();
    value(await db().from('comments').delete().eq('id', id));
  }
  async function likes(type, ids) {
    await auth.ready();
    if (!auth.configured() || !ids.length) return {};
    if (!['post', 'comment', 'moment', 'album', 'content'].includes(type)) throw new Error('无效点赞类型。');
    var out = {};
    var uniqueIds = Array.from(new Set(ids.map(String)));
    for (var start = 0; start < uniqueIds.length; start += 100) {
      var batch = uniqueIds.slice(start, start + 100);
      batch.forEach(function (id) { out[id] = { count: 0, liked: false }; });
      var counts = value(await db().rpc('like_counts', { p_target_type: type, p_target_ids: batch }));
      counts.forEach(function (row) { out[row.target_id].count = Number(row.like_count); });
      if (auth.user()) {
        var mine = value(await db().from('likes').select('target_id')
          .eq('user_id', auth.user().id).eq('target_type', type).in('target_id', batch));
        mine.forEach(function (row) { out[row.target_id].liked = true; });
      }
    }
    return out;
  }
  async function followerCount(targetId) {
    await auth.ready();
    if (!auth.configured()) return 0;
    return Number(value(await db().rpc('follower_count', { p_target_id: targetId })));
  }
  async function userLikeCount(userId) {
    await auth.ready();
    if (!auth.configured()) return 0;
    return Number(value(await db().rpc('user_like_count', { p_user_id: userId })));
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
    return value(await db().from('profiles').select('id,username,display_name,avatar_url,bio').eq('id', id).maybeSingle());
  }
  async function saveProfile(changes, expectedActor) {
    await auth.ready();
    var id = requireLogin();
    if(expectedActor && id!==expectedActor)throw Error('账号已变化。');
    return value(await db().from('profiles').update(changes).eq('id', id).select().single());
  }
  async function uploadAvatar(file, expectedActor) {
    await auth.ready();
    var id = requireLogin();
    if(expectedActor && id!==expectedActor)throw Error('账号已变化。');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('头像须为 2 MB 内的 JPG、PNG 或 WebP。');
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    var path = id + '/avatar-' + Date.now() + '.' + ext;
    value(await db().storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false }));
    var url = db().storage.from('avatars').getPublicUrl(path).data.publicUrl;
    await saveProfile({ avatar_url: url }, id);
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
  window.BlogData = { errorMessage:Backend_FormatError, listComments: listComments, addComment: addComment, listModeration: listModeration,
    listLatestComments: listLatestComments,
    listNotifications: listNotifications, notificationCount: notificationCount, markNotificationsRead: markNotificationsRead, dmUnreadCount: dmUnreadCount, messageUnreadCount: messageUnreadCount,
    moderateComment: moderateComment, deleteComment: deleteComment, likes: likes, toggleLike: toggleLike,
    followerCount: followerCount, userLikeCount: userLikeCount,
    getProfile: getProfile, saveProfile: saveProfile, uploadAvatar: uploadAvatar, following: following, toggleFollow: toggleFollow };
})();
