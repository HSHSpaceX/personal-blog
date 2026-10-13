(function () {
  'use strict';

  var moments = [];
  function allMoments(){return window.CommunityPublic?window.CommunityPublic.mergeMoments(moments):moments;}
  function isCommunity(id){return allMoments().some(function(m){return m.id===id&&m.community;});}
  var pendingMedia = [];
  var booted = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function isAuthed() { return !!window.BlogAuth.user(); }

  function siteName() {
    return (window.SITE_CONTENT && window.SITE_CONTENT.siteName) || '拾光手记';
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function uid(prefix) {
    var now = new Date();
    return (prefix || 'm') + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) +
      '-' + Math.random().toString(36).slice(2, 6);
  }

  function nowText() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  }

  function timeAgo(time) {
    var date = new Date(String(time || '').replace(' ', 'T'));
    if (isNaN(date.getTime())) return time || '';
    var minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + ' 分钟前';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' 小时前';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + ' 天前';
    return String(time).slice(0, 10);
  }

  var likeState = {};
  function getLiked(id) { return !!(likeState[id] && likeState[id].liked); }
  function getCachedCount(id) { return (likeState[id] && likeState[id].count) || 0; }
  function updateLikeUI(id, row) {
    var btn = document.querySelector('[data-like="' + id + '"]');
    if (!btn) return;
    btn.classList.toggle('liked', row.liked);
    btn.setAttribute('aria-label', row.liked ? '取消点赞' : '点赞');
    btn.querySelector('.moment-action-count').textContent = String(row.count);
  }
  async function refreshLikeCounts() {
    try {
      var groups=await Promise.all([window.BlogData.likes('moment',moments.map(function(m){return m.id;})),window.BlogData.likes('content',allMoments().filter(function(m){return m.community;}).map(function(m){return m.id;}))]);likeState=Object.assign({},groups[0],groups[1]);
      allMoments().forEach(function (m) { updateLikeUI(m.id, likeState[m.id] || { liked: false, count: 0 }); });
    } catch (error) { /* offline */ }
  }
  async function toggleMomentLike(id) {
    if (!window.BlogAuth.user()) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash); return; }
    try { await window.BlogData.toggleLike(isCommunity(id)?'content':'moment', id); await refreshLikeCounts(); }
    catch (error) { alert(error.message); }
  }

  function momentShareUrl(id) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'moments.html#'+(isCommunity(id)?'community-':'moment-') + id;
  }

  function flashCopied(btn) {
    btn.classList.add('copied');
    window.setTimeout(function () {
      btn.classList.remove('copied');
    }, 1600);
  }

  function shareMoment(id) {
    var item = null;
    moments.forEach(function (entry) {
      if (entry.id === id) item = entry;
    });
    var url = momentShareUrl(id);
    var text = item && item.text ? item.text.slice(0, 80) : '一条动态';
    if (navigator.share) {
      navigator.share({ title: siteName(), text: text, url: url }).catch(function () {
        /* 用户取消分享 */
      });
      return;
    }
    var btn = document.querySelector('[data-share="' + id + '"]');
    function done() {
      if (btn) flashCopied(btn);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () {
        window.prompt('复制这条动态的链接:', url);
      });
    } else {
      window.prompt('复制这条动态的链接:', url);
    }
  }

  function commentSlug(id) {
    return (isCommunity(id)?'community-':'moment-') + id;
  }

  var commentCache = {};
  function commentCount(id) { return (commentCache[id] || []).length; }

  function commentItemHtml(item, all) {
    var replies = (all || []).filter(function (entry) {
      return entry.parentId === item.id;
    });
    return '<div class="comment-item moment-comment-item">' +
      '<div class="comment-head"><img class="comment-avatar" src="' + escapeHtml(item.avatar && /^https:\/\//.test(item.avatar) ? item.avatar : (item.nick === 'HSH(站长)' ? 'assets/icon.jpg' : 'assets/avatar-default.jpg')) + '" alt="">' +
      (item.username
        ? '<a class="comment-author" href="profile.html?username=' + encodeURIComponent(item.username) + '">' + escapeHtml(item.nick) + '</a>'
        : '<strong>' + escapeHtml(item.nick) + '</strong>') + '<span>' + escapeHtml(item.time || '') + '</span>' +
      (item.status === 'pending' ? '<span>待审核</span>' : '') +
      '</div>' +
      (item.parentNick ? '<p class="comment-parent-hint">回复 @' + escapeHtml(item.parentNick) + '</p>' : '') +
      '<p class="comment-content">' + escapeHtml(item.content) + '</p>' +
      '<div class="comment-foot">' + (window.CommentLikes && item.status === 'approved' && !item.legacy ? window.CommentLikes.button(String(item.id)) : '') +
        (item.own&&!item.legacy?'<a class="btn" rel="nofollow" href="account.html?comment='+encodeURIComponent(item.id)+'#my-comments">编辑我的评论</a>':'') +
        '<button type="button" class="comment-reply-btn" data-mcreply="' + escapeHtml(item.id) + '" data-mcnick="' + escapeHtml(item.nick) + '">回复</button>' +
      '</div>' +
      (replies.length ? '<button type="button" class="comment-collapse-toggle" data-collapsed="true">展开 ' + replies.length + ' 条回复</button><div class="comment-replies" hidden>' + replies.map(function (reply) {
        return commentItemHtml(reply, all);
      }).join('') + '</div>' : '') +
    '</div>';
  }

  async function renderMomentComments(id) {
    var panel = document.getElementById('comments-' + id);
    if (!panel) return;
    try { commentCache[id] = await window.BlogData.listComments(commentSlug(id)); }
    catch (error) { panel.textContent = '评论加载失败：' + error.message; return; }
    var data = commentCache[id];
    var items = data.filter(function (entry) { return !entry.parentId; });
    panel.innerHTML = '<div class="moment-comment-list">' +
      (items.length ? items.map(function (entry) { return commentItemHtml(entry, data); }).join('') : '<p class="empty-state">还没有评论。</p>') +
      '</div><form class="moment-comment-form" data-moment-form="' + escapeHtml(id) + '">' +
      '<textarea name="content" rows="2" maxlength="2000" placeholder="登录后写下评论…"></textarea>' +
      '<div class="moment-comment-foot"><span class="status-line"></span><button class="comment-submit" type="submit">评论</button></div></form>';
    if (window.CommentLikes) window.CommentLikes.decorate(panel);
    updateCommentCount(id);
  }

  function updateCommentCount(id) {
    var btn = document.querySelector('[data-comments="' + id + '"]');
    if (!btn) return;
    var num = btn.querySelector('.moment-comment-count');
    if (num) num.textContent = String(commentCount(id));
  }

  function toggleComments(id) {
    var panel = document.getElementById('comments-' + id);
    if (!panel) return;
    if (panel.hidden) {
      renderMomentComments(id);
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  }

  async function submitMomentComment(form) {
    var id = form.getAttribute('data-moment-form');
    var content = form.querySelector('[name="content"]').value.trim();
    var status = form.querySelector('.status-line');
    var button = form.querySelector('button[type="submit"]');
    if (!content) { setStatus(status, '请输入评论内容。', 'err'); return; }
    if (!window.BlogAuth.user()) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash); return; }
    button.disabled = true;
    try {
      await window.BlogData.addComment(commentSlug(id), content, form._replyTarget && form._replyTarget.id);
      await renderMomentComments(id);
      var next = document.querySelector('[data-moment-form="' + id + '"] .status-line');
      setStatus(next, '评论已提交，审核通过后公开可见。', 'ok');
    } catch (error) { setStatus(status, '提交失败：' + error.message, 'err'); }
    finally { button.disabled = false; }
  }

  function setReplyTo(form, commentId, nick) {
    form._replyTarget = { id: commentId, nick: nick };
    clearReplyBanner(form);
    var banner = document.createElement('div');
    banner.className = 'comment-reply-banner';
    banner.innerHTML = '回复 @' + escapeHtml(nick) + ' <button type="button" class="comment-reply-cancel" aria-label="取消回复">×</button>';
    form.insertBefore(banner, form.firstChild);
    banner.querySelector('.comment-reply-cancel').addEventListener('click', function () {
      form._replyTarget = null;
      clearReplyBanner(form);
    });
  }

  function clearReplyBanner(form) {
    var old = form.querySelector('.comment-reply-banner');
    if (old) old.remove();
  }

  function renderFeed() {
    var list = $('momentList');
    if (!list) return;
    if (!allMoments().length) {
      list.innerHTML = '<p class="empty-state">还没有动态' + (isAuthed() ? ',写下第一条吧。' : '。') + '</p>';
      return;
    }
    var sorted = allMoments().slice().sort(function (a, b) {
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
    var authed = isAuthed();
    list.innerHTML = sorted.map(function (item) {
      var liked = getLiked(item.id);
      var count = getCachedCount(item.id);
      var author=item.author_profile||{
        username:'hshspacex',
        display_name:item.author||'HSH(站长)',
        avatar_url:item.avatar&&/^https:\/\//.test(item.avatar)?item.avatar:'assets/icon.jpg'
      };
      var displayName=author.display_name||author.username||'作者';
      var authorLink='profile.html?username='+encodeURIComponent(author.username||'');
      var authorAvatar=window.PublicCards?window.PublicCards.avatar(author.avatar_url):'assets/icon.jpg';
      return '<article class="moment-card" id="' + (item.community?'community-':'moment-') + escapeHtml(item.id) + '">' +
        '<a class="moment-avatar" href="'+escapeHtml(authorLink)+'"><img src="'+escapeHtml(authorAvatar)+'" alt=""></a>' +
        '<div class="moment-body">' +
          '<div class="moment-head">' +
            '<a class="moment-name" href="'+escapeHtml(authorLink)+'">'+escapeHtml(displayName)+' / @'+escapeHtml(author.username||'')+'</a>' +
            '<span class="moment-time" title="' + escapeHtml(item.time || '') + '">' + escapeHtml(timeAgo(item.time)) + '</span>' +
          '</div>' +
          (item.document&&window.CommunityPublic ? '<div class="moment-text prose">'+window.CommunityPublic.bodyHTML(item.public_item)+'</div>' : (item.text ? '<p class="moment-text">' + escapeHtml(item.text).replace(/\n/g, '<br>') + '</p>' : '')) +
          (item.media && item.media.length
            ? '<div class="moment-media-grid moment-media-' + Math.min(item.media.length, 4) + '">' + item.media.map(function (m, i) {
                if (m.type && m.type.indexOf('video/') === 0) {
                  return '<div class="moment-media-item moment-media-video"><video src="' + escapeHtml(m.src) + '" controls playsinline preload="metadata"></video></div>';
                }
                if(m.type&&!m.type.startsWith('image/'))return '<p><a href="'+escapeHtml(m.src)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(m.name||'附件')+'</a></p>';
                return '<div class="moment-media-item moment-media-img"><img src="' + escapeHtml(m.src) + '" alt="配图' + (i + 1) + '" loading="eager" decoding="async"></div>';
              }).join('') + '</div>'
            : (item.image ? '<div class="moment-media-grid moment-media-1"><div class="moment-media-item moment-media-img"><img src="' + escapeHtml(item.image) + '" alt="动态配图" loading="eager" decoding="async"></div></div>' : '')) +
          '<div class="moment-actions">' +
            '<button class="moment-action-btn moment-like-btn' + (liked ? ' liked' : '') + '" type="button" data-like="' + escapeHtml(item.id) + '" aria-label="' + (liked ? '取消点赞' : '点赞') + '">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.6-4.9-10-9.4C.4 8.5 2.5 4.9 6 4.9c2 0 3.4 1.1 4.2 2.4h3.6c.8-1.3 2.2-2.4 4.2-2.4 3.5 0 5.6 3.6 4 6.7C19.6 16.1 12 21 12 21z"/></svg>' +
              '<span class="moment-action-count">' + count + '</span>' +
            '</button>' +
            '<button class="moment-action-btn moment-share-btn" type="button" data-share="' + escapeHtml(item.id) + '" aria-label="分享这条动态" title="分享">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>' +
            '</button>' +
            '<button class="moment-action-btn moment-comment-btn" type="button" data-comments="' + escapeHtml(item.id) + '" aria-label="评论这条动态" title="评论">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
              '<span class="moment-action-count moment-comment-count">' + commentCount(item.id) + '</span>' +
            '</button>' +
            '<div class="moment-actions-right">' +
            (authed && item.public_item && item.public_item.author.id===window.BlogAuth.user().id ? '<button class="moment-delete" type="button" data-compose-delete="' + escapeHtml(item.public_item.id) + '" aria-label="删除这条动态" title="删除">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
              '</button>' : '') +
            (authed && item.public_item && item.public_item.author.id===window.BlogAuth.user().id ? '<button class="moment-edit-btn" type="button" data-compose-edit="' + escapeHtml(item.public_item.revision_id) + '" aria-label="编辑这条动态" title="编辑">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>' +
              '</button>' : '') +
            '</div>' +
          '</div>' +
          '<div class="moment-comments" id="comments-' + escapeHtml(item.id) + '" hidden></div>' +
        '</div>' +
      '</article>';
    }).join('');
    document.dispatchEvent(new Event('moments-feed-render'));
    refreshLikeCounts();
    allMoments().forEach(function (m) { window.BlogData.listComments(commentSlug(m.id)).then(function (rows) { commentCache[m.id] = rows; updateCommentCount(m.id); }).catch(function () {}); });
    if (window.SiteLightbox) window.SiteLightbox.watch(list);
  }

  function syncPanels() { $('composer').hidden=!window.BlogAuth.user(); }
  function bindEvents() {
    $('momentList').addEventListener('click', function (event) {
      var likeBtn = event.target.closest('[data-like]');
      if (likeBtn) {
        toggleMomentLike(likeBtn.getAttribute('data-like'));
        return;
      }
      var shareBtn = event.target.closest('[data-share]');
      if (shareBtn) {
        shareMoment(shareBtn.getAttribute('data-share'));
        return;
      }
      var commentBtn = event.target.closest('[data-comments]');
      if (commentBtn) {
        toggleComments(commentBtn.getAttribute('data-comments'));
        return;
      }
      var toggleBtn = event.target.closest('.comment-collapse-toggle');
      if (toggleBtn) {
        var repliesDiv = toggleBtn.nextElementSibling;
        if (!repliesDiv || !repliesDiv.classList.contains('comment-replies')) return;
        var collapsed = toggleBtn.getAttribute('data-collapsed') === 'true';
        repliesDiv.hidden = !collapsed;
        toggleBtn.setAttribute('data-collapsed', String(!collapsed));
        var count = repliesDiv.querySelectorAll('.comment-item').length;
        toggleBtn.textContent = collapsed ? '收起回复' : '展开 ' + count + ' 条回复';
        return;
      }
      var replyBtn = event.target.closest('[data-mcreply]');
      if (replyBtn) {
        var momentId = replyBtn.closest('.moment-comments').id.replace('comments-', '');
        var form = document.querySelector('[data-moment-form="' + momentId + '"]');
        if (form) setReplyTo(form, replyBtn.getAttribute('data-mcreply'), replyBtn.getAttribute('data-mcnick'));
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    });
    $('momentList').addEventListener('submit', function (event) {
      var form = event.target.closest('[data-moment-form]');
      if (form) {
        event.preventDefault();
        submitMomentComment(form);
      }
    });
  }

  function boot() {
    if (booted) return;
    booted = true;
    moments = window.BLOG_MOMENTS || [];
    bindEvents();
    syncPanels();
    renderFeed();
    window.setInterval(renderFeed, 60000);
    document.addEventListener('blog-auth-change', function () { syncPanels(); renderFeed(); });
  }

  if (window.BLOG_MOMENTS && (!window.CommunityPublic || window.COMMUNITY_PUBLIC)) {
    boot();
  } else {
    document.addEventListener('posts-ready', boot, { once: true });
  }
})();
