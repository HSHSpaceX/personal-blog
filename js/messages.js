(function () {
  'use strict';
  window.BlogTheme.setup();
  var listEl = document.getElementById('messagesList');
  var statusEl = document.getElementById('messagesStatus');
  var generation = 0;
  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = 'status-line' + (kind ? ' ' + kind : '');
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function itemHtml(item) {
    var actorLink = item.actorUsername ? 'profile.html?username=' + encodeURIComponent(item.actorUsername) : '';
    var actorName = item.actorName || (item.actorUsername ? '@' + item.actorUsername : '系统');
    var unreadClass = item.read ? '' : ' unread';
    return '<article class="comment-item message-item' + unreadClass + '">' +
      '<div class="comment-head">' +
        '<a class="message-actor" href="' + actorLink + '" aria-label="查看 ' + escapeHtml(actorName) + ' 的主页">' +
          '<img class="comment-avatar" src="' + escapeHtml(item.actorAvatar || 'assets/avatar-default.jpg') + '" alt="">' +
          '<strong>' + escapeHtml(actorName) + '</strong>' +
        '</a>' +
        '<span>' + escapeHtml((item.created_at || '').slice(0, 10)) + '</span>' +
      '</div>' +
      '<p class="comment-content">' + escapeHtml(item.title) + '</p>' +
      (item.body ? '<p class="comment-content muted">' + escapeHtml(item.body) + '</p>' : '') +
      (/^content_(approved|rejected)$/.test(item.type) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.revision_id || '')
        ? '<a class="btn" rel="nofollow" href="account.html?revision=' + encodeURIComponent(item.revision_id) + '#content">' +
          (item.type === 'content_rejected' ? '查看原因并重新编辑' : '查看发布版本') + '</a>' : '') +
    '</article>';
  }
  async function load() {
    var attempt = ++generation;
    listEl.replaceChildren();
    setStatus('正在读取个人通知…');
    try {
      await window.BlogAuth.ready();
      if (attempt !== generation) return;
      var user = window.BlogAuth.user();
      if (!user) { location.replace('login.html?next=messages.html'); return; }
      var rows = await window.BlogData.listNotifications();
      if (attempt !== generation || !window.BlogAuth.user() || window.BlogAuth.user().id !== user.id) return;
      listEl.innerHTML = rows.length ? rows.map(itemHtml).join('') : '<p class="empty-state">还没有新通知。</p>';
      if (rows.length) await window.BlogData.markNotificationsRead();
      if (attempt !== generation) return;
      document.querySelectorAll('.notification-badge').forEach(function (badge) { badge.hidden = true; });
      setStatus(rows.length ? '通知已更新。' : '暂无通知。', 'ok');
    } catch (error) { if (attempt === generation) setStatus(error.message, 'err'); }
  }
  document.addEventListener('blog-auth-change', load);
  load();
})();
