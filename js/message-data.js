(function () {
  'use strict';
  var auth = window.BlogAuth, generation = 0;
  var uuid = function (id) { return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || ''); };
  function value(result) { if (result.error) {var error=new Error(window.BlogData&&window.BlogData.errorMessage?window.BlogData.errorMessage(result.error):result.error.message);error.code=result.error.code;throw error;} return result.data; }
  function snapshot() { return { id: auth.requireUser().id, generation: generation }; }
  function check(actor) {
    if (generation !== actor.generation || !auth.user() || auth.user().id !== actor.id) throw Error('账号已变化，请重试。');
  }
  async function rpc(name, args, actor) {
    actor = actor || snapshot(); await auth.ready(); check(actor);
    var result = value(await auth.client().rpc(name, args)); check(actor); return result;
  }
  async function threadInfo(id) {
    if (!uuid(id)) throw Error('无效会话链接。');
    var actor = snapshot(); await auth.ready(); check(actor);
    var row = value(await auth.client().from('dm_threads').select('id,user_low,user_high').eq('id', id).maybeSingle());
    check(actor); if (!row || (row.user_low !== actor.id && row.user_high !== actor.id)) throw Error('会话不存在或无权访问。');
    var peer = row.user_low === actor.id ? row.user_high : row.user_low;
    var profile = value(await auth.client().from('profiles').select('id,username,display_name,avatar_url').eq('id', peer).maybeSingle());
    check(actor); if (!profile) throw Error('对方账号不可用。'); return { id: row.id, peer: profile };
  }
  async function signedAsset(id) {
    if (!uuid(id)) throw Error('无效图片标识。');
    var actor = snapshot(); await auth.ready(); check(actor);
    var asset = value(await auth.client().from('dm_assets').select('id,object_path,original_name').eq('id', id).maybeSingle());
    check(actor); if (!asset) throw Error('图片不存在或无权访问。');
    var issuedAt = Date.now();
    var result = value(await auth.client().storage.from('dm-media').createSignedUrl(asset.object_path, 60));
    check(actor); if (!result || !result.signedUrl) throw Error('无法创建安全图片链接。');
    var url = new URL(result.signedUrl), origin = new URL(window.BlogConfig.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.origin !== origin.origin) throw Error('无效图片地址。');
    if (Date.now() >= issuedAt + 60000) throw Error('图片链接已过期，请重试。');
    return { url: url.href, expiresAt: issuedAt + 60000 };
  }
  async function upload(file) {
    var actor = snapshot(); await auth.ready(); check(actor);
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    if (!ext || !file.size || file.size > 8 * 1024 * 1024) throw Error('图片须为 8 MiB 内的 JPG、PNG 或 WebP。');
    var path = actor.id + '/' + crypto.randomUUID() + '.' + ext;
    value(await auth.client().storage.from('dm-media').upload(path, file, { contentType: file.type, upsert: false }));
    check(actor);
    var id = await rpc('dm_register_asset', { p_object_path: path, p_original_name: file.name }, actor);
    return { id: id, original_name: file.name };
  }
  async function remove(name, args) {
    var actor = snapshot();
    var path = await rpc(name, args, actor); check(actor);
    if (typeof path !== 'string' || !path.startsWith(actor.id + '/') || path.includes('..') ||
        !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) throw Error('拒绝不安全的图片路径。');
    value(await auth.client().storage.from('dm-media').remove([path])); check(actor);
  }
  document.addEventListener('blog-auth-change', function () { generation++; });
  window.MessageData = {
    uuid: uuid, threadInfo: threadInfo, signedAsset: signedAsset, upload: upload,
    getThread: function (target) {
      if (!uuid(target)) throw Error('无效收件人。');
      var actor = snapshot(); return rpc('dm_get_or_create_thread', { p_target_user_id: target, p_expected_user_id: actor.id }, actor);
    },
    threads: function (offset) { return rpc('dm_threads', { p_limit: 20, p_offset: offset || 0 }); },
    messages: function (id, before) {
      if (!uuid(id)) throw Error('无效会话。');
      return rpc('dm_messages', { p_thread_id: id, p_limit: 20, p_before_no: before || null });
    },
    send: function (id, body, assets) {
      if (!uuid(id)) throw Error('无效会话。'); var actor = snapshot();
      return rpc('dm_send_message', { p_thread_id: id, p_body: body, p_asset_ids: assets, p_expected_sender_id: actor.id }, actor);
    },
    markRead: function (id, through) {
      var actor = snapshot(); return rpc('dm_mark_thread_read', { p_thread_id: id, p_through_no: through, p_expected_user_id: actor.id }, actor);
    },
    unread: function () { return rpc('dm_unread_count', {}); },
    unsent: function (offset) { return rpc('dm_unsent_assets', { p_limit: 20, p_offset: offset || 0 }); },
    orphans: function (offset) { return rpc('dm_orphan_assets', { p_limit: 20, p_offset: offset || 0 }); },
    removeAsset: function (id) { return remove('dm_prepare_asset_delete', { p_asset_id: id }); },
    removeOrphan: function (id) { return remove('dm_prepare_orphan_delete', { p_object_id: id }); }
  };
})();
