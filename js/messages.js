(function () {
  'use strict';
  var listEl = document.getElementById('messagesList');
  var statusEl = document.getElementById('messagesStatus');
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
    '</article>';
  }
  async function load() {
    try {
      await window.BlogAuth.ready();
      if (!window.BlogAuth.user()) { location.replace('login.html?next=messages.html'); return; }
      var rows = await window.BlogData.listNotifications();
      listEl.innerHTML = rows.length ? rows.map(itemHtml).join('') : '<p class="empty-state">还没有新消息。</p>';
      if (rows.length) await window.BlogData.markNotificationsRead();
      document.querySelectorAll('.notification-badge').forEach(function (badge) { badge.hidden = true; });
      setStatus(rows.length ? '消息已更新。' : '暂无消息。', 'ok');
    } catch (error) { setStatus(error.message, 'err'); }
  }
  document.addEventListener('blog-auth-change', load);
  load();
})();
