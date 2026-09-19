(function () {
  'use strict';

  var OWNER = 'HSHSpaceX';
  var REPO = 'personal-blog';
  var BRANCH = 'main';
  var MOMENTS_PATH = 'js/moments.js';

  var moments = [];
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

  function isAuthed() {
    try {
      return Number(localStorage.getItem('blog-auth') || 0) > Date.now();
    } catch (e) {
      return false;
    }
  }

  function getToken() {
    try {
      return localStorage.getItem('blog-gh-token') || '';
    } catch (e) {
      return '';
    }
  }

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

  function likedKey(id) {
    return 'blog-liked-moment-' + id;
  }

  function likeCacheKey(id) {
    return 'blog-like-count-moment-' + id;
  }

  function getLiked(id) {
    try {
      return localStorage.getItem(likedKey(id)) === '1';
    } catch (e) {
      return false;
    }
  }

  function getCachedCount(id) {
    try {
      return Number(localStorage.getItem(likeCacheKey(id))) || 0;
    } catch (e) {
      return 0;
    }
  }

  function setCachedCount(id, value) {
    try {
      localStorage.setItem(likeCacheKey(id), String(value));
    } catch (e) {
      /* 忽略 */
    }
  }

  // 点赞 = 点赞计数器 - 取消点赞计数器,404(未创建)按 0 处理
  function fetchMomentLikeDiff(id) {
    function getCounter(ns) {
      return fetch('https://abacus.jasoncameron.dev/get/' + ns + '/' + encodeURIComponent('moment-' + id))
        .then(function (res) {
          return res.ok ? res.json() : { value: 0 };
        })
        .then(function (data) {
          return (data && (data.count || data.value)) || 0;
        })
        .catch(function () {
          return null;
        });
    }
    return Promise.all([getCounter('shiguang-likes'), getCounter('shiguang-unlikes')]).then(function (results) {
      if (results[0] === null || results[1] === null) return null;
      return Math.max(0, results[0] - results[1]);
    });
  }

  function updateLikeUI(id, liked, count) {
    var btn = document.querySelector('[data-like="' + id + '"]');
    if (!btn) return;
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-label', liked ? '取消点赞' : '点赞');
    var num = btn.querySelector('.moment-action-count');
    if (num) num.textContent = String(count);
  }

  function toggleMomentLike(id) {
    var liked = !getLiked(id);
    try {
      if (liked) localStorage.setItem(likedKey(id), '1');
      else localStorage.removeItem(likedKey(id));
    } catch (e) {
      /* 忽略 */
    }
    var optimistic = Math.max(0, getCachedCount(id) + (liked ? 1 : -1));
    setCachedCount(id, optimistic);
    updateLikeUI(id, liked, optimistic);
    var ns = liked ? 'shiguang-likes' : 'shiguang-unlikes';
    // 打点之后重新拉两侧计数求差,单侧返回值会导致取消后再点赞显示成 +2
    fetch('https://abacus.jasoncameron.dev/hit/' + ns + '/' + encodeURIComponent('moment-' + id))
      .then(function () {
        return fetchMomentLikeDiff(id);
      })
      .then(function (value) {
        if (value === null) return;
        setCachedCount(id, value);
        updateLikeUI(id, getLiked(id), value);
      })
      .catch(function () {
        /* 离线时保留乐观值 */
      });
  }

  function refreshLikeCounts() {
    moments.forEach(function (item) {
      fetchMomentLikeDiff(item.id).then(function (value) {
        if (value === null) return;
        setCachedCount(item.id, value);
        updateLikeUI(item.id, getLiked(item.id), value);
      });
    });
  }

  function momentShareUrl(id) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'moments.html#moment-' + id;
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
    return 'moment-' + id;
  }

  function commentCount(id) {
    var data = (window.SITE_COMMENTS || {})[commentSlug(id)] || [];
    return data.length;
  }

  function commentItemHtml(item, all) {
    var replies = (all || []).filter(function (entry) {
      return entry.parentId === item.id;
    });
    return '<div class="comment-item moment-comment-item">' +
      '<div class="comment-head"><strong>' + escapeHtml(item.nick) + '</strong><span>' + escapeHtml(item.time || '') + '</span></div>' +
      (item.parentNick ? '<p class="comment-parent-hint">回复 @' + escapeHtml(item.parentNick) + '</p>' : '') +
      '<p class="comment-content">' + escapeHtml(item.content) + '</p>' +
      (item.reply ? '<div class="comment-reply"><strong>博主回复：</strong>' + escapeHtml(item.reply) + '</div>' : '') +
      '<div class="comment-foot">' + (window.CommentLikes ? window.CommentLikes.button(String(item.id)) : '') +
        '<button type="button" class="comment-reply-btn" data-mcreply="' + escapeHtml(item.id) + '" data-mcnick="' + escapeHtml(item.nick) + '">回复</button>' +
      '</div>' +
      (replies.length ? '<div class="comment-replies">' + replies.map(function (reply) {
        return commentItemHtml(reply, all);
      }).join('') + '</div>' : '') +
    '</div>';
  }

  function renderMomentComments(id) {
    var panel = document.getElementById('comments-' + id);
    if (!panel) return;
    var data = (window.SITE_COMMENTS || {})[commentSlug(id)] || [];
    var items = data.filter(function (entry) {
      return !entry.parentId;
    });
    panel.innerHTML =
      '<div class="moment-comment-list">' +
        (items.length ? items.map(function (entry) {
          return commentItemHtml(entry, data);
        }).join('') : '<p class="empty-state">还没有评论。</p>') +
      '</div>' +
      '<form class="moment-comment-form" data-moment-form="' + escapeHtml(id) + '">' +
        '<input type="text" name="nick" maxlength="30" placeholder="称呼(必填)" autocomplete="off">' +
        '<input type="email" name="email" maxlength="60" placeholder="邮箱(选填,回复会邮件通知)" autocomplete="off">' +
        '<textarea name="content" rows="2" maxlength="1000" placeholder="写下你的评论…"></textarea>' +
        '<div class="moment-comment-foot"><span class="status-line"></span><button class="comment-submit" type="submit">评论</button></div>' +
      '</form>';
    if (window.CommentLikes) window.CommentLikes.decorate(panel);
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

  function putCommentDirect(comment) {
    // 已登录博主:评论直接写入 comments.js,无需审核
    var headers = {
      Authorization: 'Bearer ' + getToken(),
      Accept: 'application/vnd.github+json'
    };
    var data = window.SITE_COMMENTS || {};
    if (!data[comment.slug]) data[comment.slug] = [];
    data[comment.slug].push(comment);
    var text = '/* 评论数据:在后台“消息”栏目中管理。 */\nwindow.SITE_COMMENTS = ' + JSON.stringify(data, null, 2) + ';\n';
    var content = btoa(unescape(encodeURIComponent(text)));
    var attempt = 0;
    function tryOnce() {
      return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/js/comments.js?ref=' + BRANCH, { headers: headers })
        .then(function (res) {
          if (!res.ok) throw new Error('GitHub ' + res.status);
          return res.json();
        })
        .then(function (meta) {
          return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/js/comments.js', {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
            body: JSON.stringify({
              message: '新增评论:' + comment.nick,
              content: content,
              branch: BRANCH,
              sha: meta.sha
            })
          });
        })
        .then(function (res) {
          if (!res.ok) throw new Error('GitHub ' + res.status);
          window.SITE_COMMENTS = data;
        })
        .catch(function (err) {
          attempt += 1;
          if (attempt < 3 && (String(err.message).indexOf('409') !== -1 || String(err.message).indexOf('422') !== -1)) {
            return tryOnce();
          }
          throw err;
        });
    }
    return tryOnce();
  }

  function submitMomentComment(form) {
    var id = form.getAttribute('data-moment-form');
    var nick = form.nick.value.trim();
    var mail = form.email.value.trim();
    var content = form.content.value.trim();
    var status = form.querySelector('.status-line');
    var submitBtn = form.querySelector('button[type="submit"]');
    var replyTarget = form._replyTarget || null;
    if (!nick) {
      setStatus(status, '请填写称呼。', 'err');
      return;
    }
    if (!content) {
      setStatus(status, '请填写评论内容。', 'err');
      return;
    }
    var now = new Date();
    var item = {
      id: 'c' + now.getTime(),
      slug: commentSlug(id),
      nick: nick,
      email: mail,
      time: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      content: content
    };
    if (replyTarget) {
      item.parentId = replyTarget.id;
      item.parentNick = replyTarget.nick;
    }
    submitBtn.disabled = true;
    if (isAuthed() && getToken()) {
      setStatus(status, '已登录:正在直接发布…');
      putCommentDirect(item).then(function () {
        submitBtn.disabled = false;
        form.content.value = '';
        form._replyTarget = null;
        clearReplyBanner(form);
        setStatus(status, '已发布。', 'ok');
        renderMomentComments(id);
        updateCommentCount(id);
      }).catch(function (err) {
        submitBtn.disabled = false;
        setStatus(status, '发布失败:' + err.message, 'err');
      });
      return;
    }
    if (!window.PendingComments) {
      submitBtn.disabled = false;
      setStatus(status, '提交通道暂不可用,请稍后再试。', 'err');
      return;
    }
    setStatus(status, '正在提交…');
    window.PendingComments.add(item).then(function () {
      submitBtn.disabled = false;
      form.content.value = '';
      form._replyTarget = null;
      clearReplyBanner(form);
      setStatus(status, '已提交,博主审核通过后就会显示。', 'ok');
    }).catch(function () {
      submitBtn.disabled = false;
      setStatus(status, '提交失败,请稍后再试。', 'err');
    });
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

  function saveMoments(message) {
    var token = getToken();
    if (!token) return Promise.reject(new Error('需要先连接 GitHub Token'));
    var headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    };
    var text = '/* 动态数据:在动态页登录后发布和管理。 */\nwindow.BLOG_MOMENTS = ' + JSON.stringify(moments, null, 2) + ';\n';
    var content = btoa(unescape(encodeURIComponent(text)));
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + MOMENTS_PATH + '?ref=' + BRANCH, { headers: headers })
      .then(function (res) {
        if (res.status === 404) return { sha: null };
        if (!res.ok) throw new Error('GitHub ' + res.status);
        return res.json();
      })
      .then(function (meta) {
        var body = {
          message: message,
          content: content,
          branch: BRANCH
        };
        if (meta && meta.sha) body.sha = meta.sha;
        return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + MOMENTS_PATH, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify(body)
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error('GitHub ' + res.status);
        window.BLOG_MOMENTS = moments;
      });
  }

  function putFile(path, base64, message) {
    var headers = {
      Authorization: 'Bearer ' + getToken(),
      Accept: 'application/vnd.github+json'
    };
    var body = {
      message: message,
      content: base64,
      branch: BRANCH
    };
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('GitHub ' + res.status);
    });
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      };
      reader.onerror = function () {
        reject(new Error('读取文件失败'));
      };
      reader.readAsDataURL(file);
    });
  }

  function renderFeed() {
    var list = $('momentList');
    if (!list) return;
    if (!moments.length) {
      list.innerHTML = '<p class="empty-state">还没有动态' + (isAuthed() ? ',写下第一条吧。' : '。') + '</p>';
      return;
    }
    var sorted = moments.slice().sort(function (a, b) {
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
    var authed = isAuthed();
    list.innerHTML = sorted.map(function (item) {
      var liked = getLiked(item.id);
      var count = getCachedCount(item.id);
      return '<article class="moment-card" id="moment-' + escapeHtml(item.id) + '">' +
        '<img class="moment-avatar" src="assets/icon.jpg" alt="">' +
        '<div class="moment-body">' +
          '<div class="moment-head">' +
            '<span class="moment-name">' + escapeHtml(siteName()) + '</span>' +
            '<span class="moment-time" title="' + escapeHtml(item.time || '') + '">' + escapeHtml(timeAgo(item.time)) + '</span>' +
            (authed ? '<button class="moment-delete" type="button" data-delete="' + escapeHtml(item.id) + '" aria-label="删除这条动态" title="删除">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
              '</button>' : '') +
          '</div>' +
          (item.text ? '<p class="moment-text">' + escapeHtml(item.text).replace(/\n/g, '<br>') + '</p>' : '') +
          (item.media && item.media.length
            ? '<div class="moment-media-grid moment-media-' + Math.min(item.media.length, 4) + '">' + item.media.map(function (m, i) {
                if (m.type && m.type.indexOf('video/') === 0) {
                  return '<div class="moment-media-item moment-media-video"><video src="' + escapeHtml(m.src) + '" controls playsinline preload="metadata"></video></div>';
                }
                return '<div class="moment-media-item moment-media-img"><img src="' + escapeHtml(m.src) + '" alt="配图' + (i + 1) + '" loading="lazy"></div>';
              }).join('') + '</div>'
            : (item.image ? '<div class="moment-media-grid moment-media-1"><div class="moment-media-item moment-media-img"><img src="' + escapeHtml(item.image) + '" alt="动态配图" loading="lazy"></div></div>' : '')) +
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
          '</div>' +
          '<div class="moment-comments" id="comments-' + escapeHtml(item.id) + '" hidden></div>' +
        '</div>' +
      '</article>';
    }).join('');
    refreshLikeCounts();
    if (window.SiteLightbox) window.SiteLightbox.watch(list);
  }

  function syncPanels() {
    var authed = isAuthed();
    var connected = !!getToken();
    $('momentConnect').hidden = !(authed && !connected);
    $('composer').hidden = !(authed && connected);
  }

  function clearMedia() {
    pendingMedia = [];
    renderComposerPreview();
    $('momentFileInput').value = '';
  }

  function renderComposerPreview() {
    var preview = $('composerPreview');
    if (!pendingMedia.length) {
      preview.innerHTML = '';
      preview.hidden = true;
      return;
    }
    preview.innerHTML = pendingMedia.map(function (file, index) {
      var thumb;
      if (file.type.indexOf('video/') === 0) {
        thumb = '<div class="composer-thumb-video"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>';
      } else {
        thumb = '<img src="data:' + file.type + ';base64,' + file.base64 + '" alt="预览">';
      }
      return '<div class="composer-thumb">' + thumb +
        '<button class="composer-thumb-remove" type="button" data-remove-media="' + index + '" aria-label="移除" title="移除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</div>';
    }).join('');
    preview.hidden = false;
  }

  function postMoment() {
    var textEl = $('composerText');
    var statusEl = $('composerStatus');
    var postBtn = $('composerPost');
    var text = textEl.value.trim();
    if (!text && !pendingMedia.length) {
      setStatus(statusEl, '先写点内容,或选图片/视频。', 'err');
      return;
    }
    postBtn.disabled = true;
    setStatus(statusEl, pendingMedia.length ? '上传中 0/' + pendingMedia.length + '…' : '发布中…');
    var added = null;
    var mediaPaths = [];
    var work = Promise.resolve();
    pendingMedia.forEach(function (file, i) {
      work = work.then(function () {
        setStatus(statusEl, '上传中 ' + (i + 1) + '/' + pendingMedia.length + '…');
        var ext = String(file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        var path = 'assets/moments/' + uid('m-') + '.' + ext;
        return putFile(path, file.base64, '上传动态附件').then(function () {
          mediaPaths.push({ type: file.type, src: path });
        });
      });
    });
    work.then(function () {
      added = {
        id: uid('m'),
        time: nowText(),
        text: text,
        image: mediaPaths.length && mediaPaths[0].type.indexOf('image/') === 0 ? mediaPaths[0].src : '',
        media: mediaPaths
      };
      moments.unshift(added);
      setStatus(statusEl, '发布中…');
      return saveMoments('发布动态');
    }).then(function () {
      textEl.value = '';
      clearMedia();
      renderFeed();
      setStatus(statusEl, '已发布,约 1 分钟后所有人可见。', 'ok');
    }).catch(function (err) {
      if (added) {
        var index = moments.indexOf(added);
        if (index !== -1) moments.splice(index, 1);
      }
      setStatus(statusEl, '发布失败:' + err.message, 'err');
    }).then(function () {
      postBtn.disabled = false;
    });
  }

  function deleteMoment(id) {
    var index = -1;
    moments.forEach(function (item, i) {
      if (item.id === id) index = i;
    });
    if (index === -1) return;
    if (!window.confirm('确定删除这条动态吗?')) return;
    var removed = moments.splice(index, 1)[0];
    renderFeed();
    setStatus($('momentStatus'), '删除中…');
    saveMoments('删除动态').then(function () {
      setStatus($('momentStatus'), '已删除,约 1 分钟后生效。', 'ok');
    }).catch(function (err) {
      moments.splice(index, 0, removed);
      renderFeed();
      setStatus($('momentStatus'), '删除失败:' + err.message, 'err');
    });
  }

  function connect() {
    var input = $('momentTokenInput');
    var statusEl = $('momentConnectStatus');
    var value = input.value.trim();
    if (!value) {
      setStatus(statusEl, '请先粘贴 Token。', 'err');
      return;
    }
    setStatus(statusEl, '验证中…');
    fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + value,
        Accept: 'application/vnd.github+json'
      }
    }).then(function (res) {
      if (!res.ok) throw new Error('Token 无效(' + res.status + ')');
      try {
        localStorage.setItem('blog-gh-token', value);
      } catch (e) {
        /* 忽略 */
      }
      setStatus(statusEl, '已连接。', 'ok');
      syncPanels();
    }).catch(function (err) {
      setStatus(statusEl, err.message, 'err');
    });
  }

  function bindEvents() {
    $('composerPost').addEventListener('click', postMoment);
    $('composerImgBtn').addEventListener('click', function () {
      $('momentFileInput').click();
    });
    $('momentFileInput').addEventListener('change', function (event) {
      var files = Array.prototype.slice.call(event.target.files || []);
      if (!files.length) return;
      var loaded = 0;
      files.forEach(function (file) {
        fileToBase64(file).then(function (base64) {
          pendingMedia.push({ base64: base64, name: file.name || 'file', type: file.type || 'image/jpeg' });
          loaded += 1;
          if (loaded === files.length) renderComposerPreview();
        }).catch(function (err) {
          setStatus($('composerStatus'), err.message, 'err');
        });
      });
    });
    $('composerPreview').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-remove-media]');
      if (!btn) return;
      pendingMedia.splice(Number(btn.getAttribute('data-remove-media')), 1);
      renderComposerPreview();
    });
    $('momentConnectBtn').addEventListener('click', connect);
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
      var replyBtn = event.target.closest('[data-mcreply]');
      if (replyBtn) {
        var momentId = replyBtn.closest('.moment-comments').id.replace('comments-', '');
        var form = document.querySelector('[data-moment-form="' + momentId + '"]');
        if (form) setReplyTo(form, replyBtn.getAttribute('data-mcreply'), replyBtn.getAttribute('data-mcnick'));
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      var btn = event.target.closest('[data-delete]');
      if (btn) deleteMoment(btn.getAttribute('data-delete'));
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
  }

  if (window.BLOG_MOMENTS) {
    boot();
  } else {
    document.addEventListener('posts-ready', boot, { once: true });
  }
})();
