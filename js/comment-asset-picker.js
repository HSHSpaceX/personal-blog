/* 评论图片选择器：打开资源中心，选中图片后复制到公开桶，返回永久公开地址。
 *
 * 资源中心的 community-assets 是私有桶，签名地址只有 60 秒；评论需要对所有访客
 * 长期可见，所以这里把选中的图片复制到公开的 avatars 桶（按用户目录存放）。
 * 如果以后新增专用的 comment-images 公开桶，只需修改 PUBLIC_BUCKET。 */
(function (root) {
  'use strict';

  var PUBLIC_BUCKET = 'avatars';
  var MAX_BYTES = 2 * 1024 * 1024 - 64 * 1024;
  var dialog = null, listEl = null, statusEl = null, searchEl = null, pageEl = null, prevEl = null, nextEl = null;
  var offset = 0, token = 0, onSelect = null, returnFocus = null;

  function node(tag, text, cls) {
    var el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  function uuid() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    } catch (error) { /* 忽略 */ }
    return 'c' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function isPublicUrl(url) {
    try {
      var u = new URL(url);
      if (u.protocol === 'https:') return true;
      /* 本地 Supabase（http://127.0.0.1:54321 等）允许 http。 */
      if (u.protocol === 'http:') {
        return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
      }
    } catch (error) { /* 非法 URL */ }
    return false;
  }

  function message(error) {
    if (!error) return '未知错误';
    return error.message || error.error_description || String(error);
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  function build() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'resource-picker rm-modal comment-asset-picker';
    dialog.setAttribute('aria-labelledby', 'commentAssetPickerTitle');
    dialog.innerHTML =
      '<div class="rm-head">' +
        '<h2 id="commentAssetPickerTitle">选择评论图片</h2>' +
        '<button class="rm-close" type="button" data-close aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="rm-upload-bar">' +
        '<label>搜索资源<input type="search" maxlength="120" placeholder="按文件名搜索" data-search-input></label>' +
        '<button class="btn" type="button" data-search>搜索</button>' +
      '</div>' +
      '<p class="status-line" role="status" aria-live="polite" data-status></p>' +
      '<div class="rm-body" data-list></div>' +
      '<div class="rm-foot">' +
        '<button class="btn" type="button" data-prev>上一页</button>' +
        '<span data-page aria-live="polite"></span>' +
        '<button class="btn" type="button" data-next>下一页</button>' +
      '</div>';
    document.body.appendChild(dialog);

    listEl = dialog.querySelector('[data-list]');
    statusEl = dialog.querySelector('[data-status]');
    searchEl = dialog.querySelector('[data-search-input]');
    pageEl = dialog.querySelector('[data-page]');
    prevEl = dialog.querySelector('[data-prev]');
    nextEl = dialog.querySelector('[data-next]');

    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelector('[data-search]').addEventListener('click', function () { offset = 0; load(); });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('close', cleanup);
    prevEl.addEventListener('click', function () { offset = Math.max(0, offset - 20); load(); });
    nextEl.addEventListener('click', function () { offset += 20; load(); });
    searchEl.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); offset = 0; load(); }
    });
  }

  async function thumbnail(client, asset, thumb, current) {
    try {
      var row = await client.from('user_assets').select('object_path').eq('id', asset.id).maybeSingle();
      if (current !== token) return;
      if (row.error) throw row.error;
      if (!row.data || !row.data.object_path) return;
      var signed = await client.storage.from('community-assets').createSignedUrl(row.data.object_path, 60);
      if (current !== token) return;
      if (signed.error) throw signed.error;
      var img = node('img');
      img.alt = asset.original_name || '图片';
      img.loading = 'lazy';
      img.src = signed.data.signedUrl;
      thumb.replaceChildren(img);
    } catch (error) {
      /* 缩略图失败时保留占位图标，不影响选择。 */
    }
  }

  function render(client, rows, current) {
    listEl.replaceChildren();
    rows.forEach(function (asset) {
      var card = node('article', undefined, 'rm-item');
      card.dataset.assetId = asset.id;
      var thumb = node('div', undefined, 'rm-thumb');
      thumb.appendChild(node('span', '🖼️', 'rm-icon'));
      var info = node('div', undefined, 'rm-info');
      info.appendChild(node('strong', asset.original_name || '图片'));
      info.appendChild(node('span', Math.ceil((asset.size_bytes || 0) / 1024) + ' KiB · ' + (asset.mime_type || 'image')));
      var actions = node('div', undefined, 'rm-actions');
      var choose = node('button', '选择', 'btn primary');
      choose.type = 'button';
      choose.addEventListener('click', function () { select(client, asset, choose, current); });
      actions.appendChild(choose);
      card.append(thumb, info, actions);
      listEl.appendChild(card);
      thumbnail(client, asset, thumb, current);
    });
  }

  async function load() {
    var auth = root.BlogAuth;
    if (!auth || !auth.user()) return;
    var client;
    try { client = auth.client(); } catch (error) { setStatus(message(error), 'err'); return; }
    var current = ++token;
    setStatus('正在读取资源…');
    listEl.replaceChildren();
    prevEl.disabled = true;
    nextEl.disabled = true;
    pageEl.textContent = '';
    try {
      var result = await client.rpc('community_assets_page', {
        p_search: searchEl.value.trim(),
        p_kind: 'image',
        p_limit: 20,
        p_offset: offset
      });
      if (current !== token) return;
      if (result.error) throw result.error;
      var all = Array.isArray(result.data) ? result.data : [];
      var rows = all.filter(function (asset) { return /^image\/(jpeg|png|webp)$/.test(asset.mime_type || ''); });
      render(client, rows, current);
      prevEl.disabled = offset === 0;
      nextEl.disabled = all.length < 20;
      pageEl.textContent = '第 ' + (offset / 20 + 1) + ' 页';
      setStatus(rows.length ? '' : '没有图片资源。请先到账号中心的资源中心上传图片。');
    } catch (error) {
      if (current === token) setStatus('资源加载失败：' + message(error), 'err');
    }
  }

  function bitmap(blob) {
    if (typeof root.createImageBitmap === 'function') return root.createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('无法读取图片。')); };
      img.src = url;
    });
  }

  async function compress(blob) {
    if (!/^image\//.test(blob.type || '')) throw new Error('只能插入图片。');
    if (blob.size > 0 && blob.size <= MAX_BYTES && /^image\/(jpeg|png|webp)$/.test(blob.type)) return blob;
    var source = await bitmap(blob);
    var width = source.width || source.naturalWidth;
    var height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('无法读取图片尺寸。');
    var scale = Math.min(1, 1600 / Math.max(width, height));
    var quality = 0.9;
    for (var attempt = 0; attempt < 7; attempt++) {
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      var context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      var out = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
      if (out && out.size <= MAX_BYTES) return out;
      if (quality > 0.6) quality -= 0.1;
      else scale *= 0.8;
    }
    throw new Error('图片压缩后仍超过 2 MB，请先在资源中心压缩图片。');
  }

  async function publish(client, user, asset) {
    var row = await client.from('user_assets').select('object_path,mime_type,original_name').eq('id', asset.id).maybeSingle();
    if (row.error) throw row.error;
    if (!row.data || !row.data.object_path) throw new Error('资源不可访问。');
    var signed = await client.storage.from('community-assets').createSignedUrl(row.data.object_path, 60);
    if (signed.error) throw signed.error;
    var response = await fetch(signed.data.signedUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('读取资源失败（' + response.status + '）。');
    var blob = await response.blob();
    if (!blob.type) blob = new Blob([blob], { type: row.data.mime_type || asset.mime_type || 'image/jpeg' });
    blob = await compress(blob);
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[blob.type] || 'jpg';
    var path = user.id + '/comments/' + uuid() + '.' + ext;
    var uploaded = await client.storage.from(PUBLIC_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    var pub = client.storage.from(PUBLIC_BUCKET).getPublicUrl(path);
    var url = pub.data && pub.data.publicUrl;
    if (!isPublicUrl(url || '')) throw new Error('公开图片地址无效。');
    return { url: url, name: row.data.original_name || asset.original_name || '图片', mime: blob.type };
  }

  async function select(client, asset, button, current) {
    if (current !== token) return;
    button.disabled = true;
    setStatus('正在准备图片…');
    try {
      var user = root.BlogAuth.requireUser();
      var image = await publish(client, user, asset);
      if (current !== token) return;
      var callback = onSelect;
      if (callback) callback(image);
      close();
    } catch (error) {
      if (current === token) setStatus('插入失败：' + message(error), 'err');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function cleanup() {
    token++;
    if (listEl) listEl.replaceChildren();
    setStatus('');
    onSelect = null;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  function open(options) {
    build();
    onSelect = options && options.onSelect;
    returnFocus = document.activeElement;
    var auth = root.BlogAuth;
    if (!auth) {
      root.alert('登录组件未加载，请刷新页面后重试。');
      return;
    }
    auth.ready().then(function () {
      if (!auth.user()) {
        root.location.href = 'login.html?next=' + encodeURIComponent(root.location.pathname + root.location.search);
        return;
      }
      offset = 0;
      searchEl.value = '';
      setStatus('');
      if (!dialog.open) dialog.showModal();
      load();
    }).catch(function (error) {
      root.alert('无法打开资源中心：' + message(error));
    });
  }

  root.CommentAssetPicker = { open: open, close: close };
})(typeof window === 'object' ? window : globalThis);
