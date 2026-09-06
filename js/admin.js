(function () {
  'use strict';

  var OWNER = 'HSHSpaceX';
  var REPO = 'personal-blog';
  var BRANCH = 'main';
  var POSTS_PATH = 'js/posts.js';
  var CONTENT_PATH = 'js/content.js';
  var API_ROOT = 'https://api.github.com';
  var TOKEN_KEY = 'blog-gh-token';
  var AUTH_KEY = 'blog-auth';
  var DEFAULT_CONTENT = {
    siteName: '拾光手记',
    introTitle: '记录思考，也记录生活。',
    introText: '这里写一些技术笔记、读书感想和日常观察。不赶热点，只写值得留下来的内容。',
    aboutTitle: '关于这个博客',
    aboutText: '这是一个安静的个人空间。文章以技术笔记、阅读记录和旅途见闻为主，偶尔也会写一些不成体系的思考。内容不多，但每篇都认真对待。',
    contactEmail: 'hello@example.com',
    aboutPage: '<p>你好，欢迎来到拾光手记。这里是我用来安放文字和想法的小角落。</p>\n<p>我平时写代码，也读书、拍照、去山里走走。这个博客不追求更新频率，只希望留下的每一篇，过一段时间回头看仍然觉得值得。</p>\n<h2>我在写什么</h2>\n<ul>\n<li>技术笔记：以实用和长期有效为标准，记录踩坑和思考。</li>\n<li>读书清单：把读过的书和当时的感受放在一起。</li>\n<li>生活记录：旅行、散步、季节变化，以及一些不成体系的想法。</li>\n</ul>\n<h2>联系我</h2>\n<p>欢迎通过邮件交流：<a href="mailto:hello@example.com">hello@example.com</a></p>'
  };

  var posts = [];
  var deletedSlugs = [];
  var postsSha = null;
  var token = '';
  var editingIndex = -1;
  var isNewPost = false;
  var dirty = false;
  var previewMode = new URLSearchParams(window.location.search).has('preview');
  var sourceMode = false;
  var tools = [
    { label: 'H2', block: 'h2', snippet: '<h2>小标题</h2>\n' },
    { label: '粗体', cmd: 'bold', snippet: '<strong>加粗文字</strong>' },
    { label: '斜体', cmd: 'italic', snippet: '<em>斜体文字</em>' },
    { label: '引用', block: 'blockquote', snippet: '<blockquote><p>引用的话</p></blockquote>' },
    { label: '列表', cmd: 'insertUnorderedList', snippet: '<ul>\n  <li>列表项</li>\n</ul>' },
    { label: '代码', block: 'pre', snippet: '<pre><code>code here</code></pre>' },
    { label: '链接', cmd: 'createLink', snippet: '<a href="https://example.com">链接文字</a>' },
    { label: '图片', cmd: 'insertLocalImage', snippet: '<img src="assets/posts/xxx.jpg" alt="插图">' },
    { label: '视频', cmd: 'insertLocalVideo', snippet: '<video controls preload="metadata" src="assets/videos/xxx.mp4"></video>' },
    { label: '资源', cmd: 'insertLocalFile', snippet: '<p><a href="assets/files/xxx.zip" download>资源下载</a></p>' },
    { label: '公式', cmd: 'insertFormula', snippet: '$$公式$$' }
  ];

  var messageComments = null;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function saveToken(value) {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch (e) {
      /* 本地存储不可用时仅在本次会话生效 */
    }
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* 忽略 */
    }
  }

  function isAuthed() {
    try {
      var until = Number(localStorage.getItem(AUTH_KEY) || 0);
      return until > Date.now();
    } catch (e) {
      return false;
    }
  }

  function setStatus(el, message, kind) {
    el.textContent = message;
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  function friendlyApiError(error) {
    if (error.status === 403 && /not accessible/i.test(error.message || '')) {
      return 'Token 缺少写权限（Contents: Read and write）。请按“如何创建 Token”重新生成，然后退出并重新连接。';
    }
    return error.message;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function stamp(date) {
    return '' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) +
      '-' + pad(date.getHours()) + pad(date.getMinutes());
  }

  function today() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function apiHeaders() {
    return {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign(apiHeaders(), options.headers || {});
    var init = { method: options.method || 'GET', headers: headers };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    var response = await fetch(API_ROOT + path, init);
    if (!response.ok) {
      var message = 'GitHub API 错误（' + response.status + '）';
      try {
        var data = await response.json();
        if (data && data.message) message = data.message;
      } catch (e) {
        /* 保留默认错误信息 */
      }
      var error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function fetchPostsMeta() {
    var data = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + POSTS_PATH + '?ref=' + BRANCH);
    postsSha = data.sha;
    return data;
  }

  function escapeTemplate(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
  }

  function serializePosts() {
    var lines = [];
    lines.push('/* 文章数据：修改或新增文章后，首页、归档和文章页会自动更新。 */');
    lines.push('window.BLOG_POSTS = [');
    posts.forEach(function (post, index) {
      lines.push('  {');
      lines.push('    slug: ' + JSON.stringify(post.slug) + ',');
      lines.push('    title: ' + JSON.stringify(post.title) + ',');
      lines.push('    category: ' + JSON.stringify(post.category) + ',');
      lines.push('    tags: ' + JSON.stringify(post.tags) + ',');
      lines.push('    date: ' + JSON.stringify(post.date) + ',');
      lines.push('    readingTime: ' + (parseInt(post.readingTime, 10) || 5) + ',');
      lines.push('    cover: ' + JSON.stringify(post.cover) + ',');
      if (post.featured) lines.push('    featured: true,');
      lines.push('    excerpt: ' + JSON.stringify(post.excerpt) + ',');
      lines.push('    content: `' + escapeTemplate(post.content) + '`');
      lines.push('  }' + (index < posts.length - 1 ? ',' : ''));
    });
    lines.push('];');
    return lines.join('\n') + '\n';
  }

  function toBase64(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    bytes.forEach(function (byte) {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function rawUrl(path) {
    return 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/' + path;
  }

  function fromBase64(base64) {
    var binary = atob(String(base64).replace(/\s/g, ''));
    var bytes = Uint8Array.from(binary, function (char) {
      return char.charCodeAt(0);
    });
    return new TextDecoder().decode(bytes);
  }

  function parsePostsFromText(text) {
    var sandbox = {};
    var result = new Function('window', text + '\n;return window.BLOG_POSTS || [];')(sandbox);
    if (!Array.isArray(result)) throw new Error('posts.js 内容格式不正确');
    return result;
  }

  async function commitPosts(message) {
    var remote = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + POSTS_PATH + '?ref=' + BRANCH);
    var remotePosts = parsePostsFromText(fromBase64(remote.content));

    var merged = [];
    var seen = {};
    remotePosts.forEach(function (post) {
      if (!post || !post.slug || deletedSlugs.indexOf(post.slug) !== -1) return;
      var local = posts.filter(function (item) { return item.slug === post.slug; })[0];
      merged.push(local || post);
      seen[post.slug] = true;
    });
    posts.forEach(function (post) {
      if (seen[post.slug] || deletedSlugs.indexOf(post.slug) !== -1) return;
      merged.push(post);
      seen[post.slug] = true;
    });
    posts = merged;

    var data = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + POSTS_PATH, {
      method: 'PUT',
      body: {
        message: message,
        content: toBase64(serializePosts()),
        branch: BRANCH,
        sha: remote.sha
      }
    });
    postsSha = data.content.sha;
    return data;
  }

  function uniqueCategories() {
    var seen = [];
    posts.forEach(function (post) {
      if (seen.indexOf(post.category) === -1) seen.push(post.category);
    });
    return seen;
  }

  function renderList() {
    var listEl = $('postList');
    if (posts.length === 0) {
      listEl.innerHTML = '<li><div><div class="post-title">还没有文章</div><div class="post-sub">点击“新文章”开始写作。</div></div></li>';
      return;
    }
    listEl.innerHTML = posts.map(function (post, index) {
      var sub = escapeHtml(post.category) + ' · ' + escapeHtml(post.date) + (post.featured ? ' · 精选' : '');
      return '<li>' +
        '<div>' +
          '<div class="post-title">' + escapeHtml(post.title || '(无标题)') + '</div>' +
          '<div class="post-sub">' + sub + '</div>' +
        '</div>' +
        '<div class="list-actions">' +
          '<button type="button" class="btn" data-edit="' + index + '">编辑</button>' +
          '<button type="button" class="btn danger" data-delete="' + index + '">删除</button>' +
        '</div>' +
      '</li>';
    }).join('');
  }

  function showAuth(message, kind) {
    showOnly('authPanel');
    setStatus($('authStatus'), message || '', kind);
  }

  function showList() {
    showOnly('appPanel');
    renderList();
  }

  function showEditor() {
    showOnly('editorPanel');
  }

  function showPage() {
    showOnly('pagePanel');
  }

  function openPagePanel() {
    var content = Object.assign({}, DEFAULT_CONTENT, window.SITE_CONTENT || {});
    $('siteName').value = content.siteName || '';
    $('introTitle').value = content.introTitle || '';
    $('introText').value = content.introText || '';
    $('aboutTitle').value = content.aboutTitle || '';
    $('aboutText').value = content.aboutText || '';
    $('contactEmail').value = content.contactEmail || '';
    $('aboutPage').value = content.aboutPage || '';
    setStatus($('pageStatus'), previewMode ? '本地预览模式：连接 GitHub 后才能保存。' : '');
    $('savePageBtn').disabled = previewMode;
    showPage();
    window.scrollTo({ top: 0 });
  }

  function collectContent() {
    var siteName = $('siteName').value.trim();
    if (!siteName) throw new Error('站点名称不能为空');
    return {
      siteName: siteName,
      introTitle: $('introTitle').value.trim() || DEFAULT_CONTENT.introTitle,
      introText: $('introText').value.trim(),
      aboutTitle: $('aboutTitle').value.trim() || DEFAULT_CONTENT.aboutTitle,
      aboutText: $('aboutText').value.trim(),
      contactEmail: $('contactEmail').value.trim(),
      aboutPage: $('aboutPage').value.trim() || DEFAULT_CONTENT.aboutPage
    };
  }

  function serializeContent(content) {
    return '/* 页面文案：在后台“页面内容”中修改。 */\nwindow.SITE_CONTENT = ' + JSON.stringify(content, null, 2) + ';\n';
  }

  async function savePageContent() {
    if (!token) {
      setStatus($('pageStatus'), '尚未连接 GitHub，无法保存。', 'err');
      return;
    }
    var content;
    try {
      content = collectContent();
    } catch (e) {
      setStatus($('pageStatus'), e.message, 'err');
      return;
    }
    setStatus($('pageStatus'), '正在提交到 GitHub…');
    try {
      var remote = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + CONTENT_PATH + '?ref=' + BRANCH);
      await api('/repos/' + OWNER + '/' + REPO + '/contents/' + CONTENT_PATH, {
        method: 'PUT',
        body: {
          message: '更新页面内容',
          content: toBase64(serializeContent(content)),
          branch: BRANCH,
          sha: remote.sha
        }
      });
      setStatus($('pageStatus'), '已保存并提交，GitHub Pages 将在一两分钟内自动发布。', 'ok');
    } catch (e) {
      setStatus($('pageStatus'), '保存失败：' + friendlyApiError(e), 'err');
    }
  }

  function showMessage() {
    showOnly('messagePanel');
    refreshPendingList();
  }

  function showOnly(panelId) {
    ['authPanel', 'appPanel', 'editorPanel', 'pagePanel', 'messagePanel'].forEach(function (pid) {
      var el = $(pid);
      if (el) el.hidden = pid !== panelId;
    });
  }

  function openMessageBox() {
    messageComments = JSON.parse(JSON.stringify(window.SITE_COMMENTS || {}));
    var slugOptions = posts.map(function (post) { return post.slug; });
    if (slugOptions.indexOf('about') === -1) slugOptions.push('about');
    $('msgSlug').innerHTML = slugOptions.map(function (slug) {
      return '<option value="' + escapeHtml(slug) + '">' + escapeHtml(slug) + '</option>';
    }).join('');
    renderMessageBox();
    showMessage();
    window.scrollTo({ top: 0 });
  }

  function renderMessageBox() {
    var flat = [];
    Object.keys(messageComments).forEach(function (slug) {
      (messageComments[slug] || []).forEach(function (item) {
        flat.push(Object.assign({ slug: slug }, item));
      });
    });
    var listEl = $('msgCommentList');
    listEl.innerHTML = flat.length
      ? flat.map(renderMsgItem).join('')
      : '<p class="empty-state">暂无评论，收到读者评论后在这里添加并发布。</p>';

    var slugSelect = $('msgSlug');
    var current = slugSelect.value;
    var slugOptions = posts.map(function (post) { return post.slug; });
    if (slugOptions.indexOf('about') === -1) slugOptions.push('about');
    slugSelect.innerHTML = slugOptions.map(function (slug) {
      return '<option value="' + escapeHtml(slug) + '">' + escapeHtml(slug) + '</option>';
    }).join('');
    if (current && slugOptions.indexOf(current) !== -1) slugSelect.value = current;
    refreshPendingList();
  }

  function renderMsgItem(item) {
    var ownerName = (window.SITE_CONTENT && window.SITE_CONTENT.siteName) || '拾光手记';
    var actions = '';
    if (item.email) {
      var body = (item.reply || '') + '\n\n—— ' + ownerName;
      actions += '<a class="btn" href="mailto:' + escapeHtml(item.email) + '?subject=' + encodeURIComponent('回复你的评论 - ' + ownerName) + '&body=' + encodeURIComponent(body) + '">邮件回复</a>';
    }
    actions += '<button type="button" class="btn danger" data-del-comment="' + escapeHtml(item.id) + '" data-del-slug="' + escapeHtml(item.slug) + '">删除</button>';
    return '' +
      '<div class="msg-item">' +
        '<div class="msg-item-head"><strong>' + escapeHtml(item.nick) + '</strong><span>' + escapeHtml(item.slug) + ' · ' + escapeHtml(item.time || '') + '</span></div>' +
        '<p class="msg-item-content">' + escapeHtml(item.content) + '</p>' +
        (item.reply ? '<div class="msg-item-reply"><strong>博主回复：</strong>' + escapeHtml(item.reply) + '</div>' : '') +
        '<div class="msg-item-actions">' + actions + '</div>' +
      '</div>';
  }

  function refreshPendingList() {
    var listEl = $('msgPendingList');
    var countEl = $('pendingCount');
    if (!listEl) return;
    if (!window.PendingComments) {
      listEl.innerHTML = '<p class="empty-state">评论通道加载中，请刷新页面重试。</p>';
      return;
    }
    window.PendingComments.list().then(function (pending) {
      if (countEl) {
        countEl.textContent = pending.length > 99 ? '99+' : String(pending.length);
        countEl.hidden = pending.length === 0;
      }
      listEl.innerHTML = pending.length
        ? pending.map(renderPendingItem).join('')
        : '<p class="empty-state">没有待审核的评论。</p>';
    }).catch(function () {
      listEl.innerHTML = '<p class="empty-state">待审核列表加载失败，请稍后重试。</p>';
    });
  }

  function renderPendingItem(item) {
    var actions = '';
    if (item.email) {
      actions += '<a class="btn" href="mailto:' + escapeHtml(item.email) + '?subject=' + encodeURIComponent('你的评论已通过审核') + '">邮件回复</a>';
    }
    actions += '<button type="button" class="btn primary" data-approve-comment="' + escapeHtml(item.id) + '">通过</button>';
    actions += '<button type="button" class="btn danger" data-delete-pending="' + escapeHtml(item.id) + '">删除</button>';
    return '' +
      '<div class="msg-item">' +
        '<div class="msg-item-head"><strong>' + escapeHtml(item.nick) + '</strong><span>' + escapeHtml(item.slug) + ' · ' + escapeHtml(item.time || '') + '</span></div>' +
        '<p class="msg-item-content">' + escapeHtml(item.content) + '</p>' +
        '<div class="msg-item-actions">' + actions + '</div>' +
      '</div>';
  }

  function approvePendingItem(id) {
    setStatus($('msgStatus'), '正在通过并发布…');
    window.PendingComments.list().then(function (pending) {
      var item = pending.filter(function (entry) { return entry.id === id; })[0];
      if (!item) return;
      if (!messageComments[item.slug]) messageComments[item.slug] = [];
      messageComments[item.slug].push({
        id: item.id,
        nick: item.nick,
        email: item.email,
        time: item.time,
        content: item.content,
        reply: ''
      });
      return saveComments().then(function () {
        return window.PendingComments.remove(id);
      }).then(function () {
        refreshPendingList();
        setStatus($('msgStatus'), '评论已通过并发布，读者刷新页面即可看到。', 'ok');
      });
    }).catch(function (e) {
      setStatus($('msgStatus'), '发布失败：' + friendlyApiError(e), 'err');
    });
  }

  function deletePendingItem(id) {
    window.PendingComments.remove(id).then(function () {
      refreshPendingList();
      setStatus($('msgStatus'), '已删除该待审核评论。');
    });
  }

  function addCommentFromForm() {
    var slug = $('msgSlug').value || 'about';
    var nick = $('msgNick').value.trim();
    var email = $('msgEmail').value.trim();
    var content = $('msgContent').value.trim();
    var reply = $('msgReply').value.trim();
    if (!nick) {
      setStatus($('msgStatus'), '请填写称呼。', 'err');
      return;
    }
    if (!content) {
      setStatus($('msgStatus'), '请填写评论内容。', 'err');
      return;
    }
    if (!messageComments[slug]) messageComments[slug] = [];
    messageComments[slug].push({
      id: 'c' + Date.now(),
      nick: nick,
      email: email,
      time: new Date().toISOString().slice(0, 10),
      content: content,
      reply: reply
    });
    $('msgNick').value = '';
    $('msgEmail').value = '';
    $('msgContent').value = '';
    $('msgReply').value = '';
    renderMessageBox();
    setStatus($('msgStatus'), '已添加，点击“保存并发布”后才会显示在网站上。', 'ok');
  }

  async function refreshLikeStats() {
    var likesEl = $('msgLikes');
    var slugs = posts.map(function (post) { return post.slug; });
    likesEl.innerHTML = '<span class="hint">加载中…</span>';
    var rows = await Promise.all(slugs.map(function (slug) {
      return fetch('https://abacus.jasoncameron.dev/get/shiguang-blog/' + encodeURIComponent(slug))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          return { slug: slug, count: (data && (data.count || data.value)) || 0 };
        })
        .catch(function () {
          return { slug: slug, count: null };
        });
    }));
    likesEl.innerHTML = rows.map(function (row) {
      return '<div class="msg-like-row"><span>' + escapeHtml(row.slug) + '</span><strong>' + (row.count === null ? '暂时无法获取' : row.count + ' 个赞') + '</strong></div>';
    }).join('');
  }

  async function saveComments() {
    if (!token) {
      setStatus($('msgStatus'), '尚未连接 GitHub，无法保存。', 'err');
      return;
    }
    var saveBtn = $('msgSaveBtn');
    saveBtn.disabled = true;
    setStatus($('msgStatus'), '正在提交到 GitHub…');
    var lastError = null;
    try {
      var text = '/* 评论数据：在后台“消息”栏目中管理。 */\nwindow.SITE_COMMENTS = ' + JSON.stringify(messageComments, null, 2) + ';\n';
      var content = toBase64(text);
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          var remote = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + CONTENT_PATH.replace('content.js', 'comments.js') + '?ref=' + BRANCH);
          await api('/repos/' + OWNER + '/' + REPO + '/contents/' + CONTENT_PATH.replace('content.js', 'comments.js'), {
            method: 'PUT',
            body: {
              message: '更新评论',
              content: content,
              branch: BRANCH,
              sha: remote.sha
            }
          });
          window.SITE_COMMENTS = JSON.parse(JSON.stringify(messageComments));
          setStatus($('msgStatus'), '已保存并提交，GitHub Pages 将在一两分钟内自动发布。', 'ok');
          lastError = null;
          break;
        } catch (retryError) {
          lastError = retryError;
          if (retryError.status !== 409 && retryError.status !== 422) break;
        }
      }
      if (lastError) {
        setStatus($('msgStatus'), '保存失败：' + friendlyApiError(lastError), 'err');
      }
    } catch (e) {
      setStatus($('msgStatus'), '保存失败：' + friendlyApiError(lastError || e), 'err');
    } finally {
      saveBtn.disabled = previewMode;
    }
  }

  function updateCoverPreview() {
    var cover = $('postCover').value.trim();
    var preview = $('coverPreview');
    if (cover) {
      preview.src = cover;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
  }

  function fillDatalists() {
    var categories = uniqueCategories();
    $('categoryOptions').innerHTML = categories.map(function (category) {
      return '<option value="' + escapeHtml(category) + '"></option>';
    }).join('');
    var covers = [];
    posts.forEach(function (post) {
      if (post.cover && covers.indexOf(post.cover) === -1) covers.push(post.cover);
    });
    $('coverOptions').innerHTML = covers.map(function (cover) {
      return '<option value="' + escapeHtml(cover) + '"></option>';
    }).join('');
  }

  function openEditor(index) {
    editingIndex = index;
    isNewPost = index < 0;
    var post;
    if (index >= 0) {
      post = posts[index];
    } else {
      post = {
        slug: 'post-' + stamp(new Date()),
        title: '',
        category: posts.length ? posts[0].category : '',
        tags: [],
        date: today(),
        readingTime: 5,
        cover: posts.length ? posts[0].cover : 'assets/covers/cover-code.jpg',
        featured: false,
        excerpt: '',
        content: '<p></p>'
      };
    }

    $('postTitle').value = post.title || '';
    $('postSlug').value = post.slug || '';
    $('postCategory').value = post.category || '';
    $('postDate').value = post.date || today();
    $('postReading').value = post.readingTime || 5;
    $('postTags').value = (post.tags || []).join(', ');
    $('postCover').value = post.cover || '';
    $('postFeatured').checked = Boolean(post.featured);
    $('postExcerpt').value = post.excerpt || '';
    setEditorContent(post.content);

    fillDatalists();
    updateCoverPreview();
    $('previewWrap').hidden = true;
    $('previewBtn').textContent = '预览';
    sourceMode = false;
    $('richEditor').hidden = false;
    $('postContent').hidden = true;
    $('sourceBtn').textContent = '源码';
    $('editorMeta').hidden = !isNewPost;
    setStatus($('editorStatus'), previewMode ? '本地预览模式：连接 GitHub 后才能保存。' : '');
    $('saveBtn').disabled = previewMode;
    $('coverFile').disabled = previewMode;
    dirty = false;
    showEditor();
    window.scrollTo({ top: 0 });
  }

  function collectForm() {
    var title = $('postTitle').value.trim();
    if (!title) throw new Error('请填写标题');
    var slug = $('postSlug').value.trim();
    if (!slug) throw new Error('请填写 slug');
    if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw new Error('slug 只能包含字母、数字、- 和 _');
    var duplicated = posts.some(function (post, index) {
      return index !== editingIndex && post.slug === slug;
    });
    if (duplicated) throw new Error('slug 已被其他文章使用：' + slug);
    var readingTime = parseInt($('postReading').value, 10);
    if (!(readingTime >= 1)) readingTime = 5;
    var tags = $('postTags').value.split(/[,，、]/).map(function (tag) {
      return tag.trim();
    }).filter(Boolean);
    return {
      slug: slug,
      title: title,
      category: $('postCategory').value.trim() || '随笔',
      tags: tags,
      date: $('postDate').value || today(),
      readingTime: readingTime,
      cover: $('postCover').value.trim() || 'assets/covers/cover-code.jpg',
      featured: $('postFeatured').checked,
      excerpt: $('postExcerpt').value.trim(),
      content: getEditorContent().trim() || '<p></p>'
    };
  }

  async function savePost() {
    if (!token) {
      setStatus($('editorStatus'), '尚未连接 GitHub，无法保存。', 'err');
      return;
    }
    var post;
    try {
      post = collectForm();
    } catch (e) {
      setStatus($('editorStatus'), e.message, 'err');
      return;
    }
    if (editingIndex >= 0) {
      posts[editingIndex] = post;
    } else {
      posts.push(post);
    }
    setStatus($('editorStatus'), '正在提交到 GitHub…');
    try {
      await commitPosts((isNewPost ? '新增文章：' : '更新文章：') + post.title);
      dirty = false;
      setStatus($('editorStatus'), '已保存并提交，GitHub Pages 将在一两分钟内自动发布。', 'ok');
      setTimeout(showList, 900);
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        fetchPostsMeta().catch(function () {});
        setStatus($('editorStatus'), '远端文件有更新，已同步状态，请再点一次“保存并发布”。', 'err');
      } else {
        setStatus($('editorStatus'), '保存失败：' + friendlyApiError(e), 'err');
      }
    }
  }

  async function deletePost(index) {
    var post = posts[index];
    if (!post) return;
    if (!window.confirm('确定删除《' + post.title + '》？删除会直接提交到 GitHub。')) return;
    deletedSlugs.push(post.slug);
    posts.splice(index, 1);
    setStatus($('listStatus'), '正在删除…');
    try {
      await commitPosts('删除文章：' + post.title);
      setStatus($('listStatus'), '已删除并提交，GitHub Pages 将在一两分钟内自动发布。', 'ok');
    } catch (e) {
      posts.splice(index, 0, post);
      setStatus($('listStatus'), '删除失败：' + friendlyApiError(e), 'err');
    }
    renderList();
  }

  function insertAtCursor(textarea, snippet) {
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
    var position = start + snippet.length;
    textarea.selectionStart = textarea.selectionEnd = position;
    textarea.focus();
  }

  function getEditorContent() {
    return sourceMode ? $('postContent').value : $('richEditor').innerHTML;
  }

  function setEditorContent(html) {
    var content = html && String(html).trim() ? html : '<p></p>';
    $('richEditor').innerHTML = content;
    $('postContent').value = content;
  }

  function toggleSourceMode() {
    var rich = $('richEditor');
    var source = $('postContent');
    if (!sourceMode) {
      source.value = rich.innerHTML;
      rich.hidden = true;
      source.hidden = false;
      sourceMode = true;
      $('sourceBtn').textContent = '可视化';
    } else {
      setEditorContent(source.value);
      rich.hidden = false;
      source.hidden = true;
      sourceMode = false;
      $('sourceBtn').textContent = '源码';
    }
  }

  function setupToolbar() {
    try {
      document.execCommand('styleWithCSS', false, 'false');
    } catch (e) {
      /* 忽略 */
    }
    var toolbar = $('contentToolbar');
    toolbar.innerHTML = tools.map(function (tool, index) {
      return '<button type="button" class="btn" data-tool="' + index + '">' + escapeHtml(tool.label) + '</button>';
    }).join('');
    toolbar.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-tool]');
      if (!button) return;
      runTool(tools[Number(button.dataset.tool)]);
    });
  }

  function runTool(tool) {
    if (sourceMode) {
      insertAtCursor($('postContent'), tool.snippet);
      return;
    }
    var editor = $('richEditor');
    editor.focus();
    if (tool.cmd === 'insertLocalImage') {
      $('insertImageFile').click();
      return;
    } else if (tool.cmd === 'insertLocalVideo') {
      $('insertVideoFile').click();
      return;
    } else if (tool.cmd === 'insertLocalFile') {
      $('insertAttachFile').click();
      return;
    } else if (tool.cmd === 'insertFormula') {
      document.execCommand('insertText', false, tool.snippet);
      dirty = true;
      return;
    } else if (tool.cmd === 'createLink') {
      var url = window.prompt('链接地址：', 'https://');
      if (!url) return;
      document.execCommand('createLink', false, url);
    } else if (tool.block) {
      var current = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      document.execCommand('formatBlock', false, current === tool.block ? '<p>' : '<' + tool.block + '>');
    } else {
      document.execCommand(tool.cmd, false, false);
    }
    dirty = true;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function () {
        reject(new Error('读取文件失败'));
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadCover(file) {
    setStatus($('editorStatus'), '正在上传封面…');
    try {
      var path = await uploadFile(file, 'assets/covers', { prefix: 'cover', ext: /^(jpg|jpeg|png|webp|gif|avif|svg)$/ });
      $('postCover').value = path;
      updateCoverPreview();
      setStatus($('editorStatus'), '封面上传成功：' + path, 'ok');
    } catch (e) {
      setStatus($('editorStatus'), '封面上传失败：' + friendlyApiError(e), 'err');
    }
  }

  async function uploadFile(file, folder) {
    var options = arguments.length > 2 ? arguments[2] : {};
    var extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
    if (options.ext && !options.ext.test(extension)) {
      throw new Error('不支持的文件类型：' + extension);
    }
    if (file.size > 90 * 1024 * 1024) {
      throw new Error('文件超过 90MB，GitHub 不支持，请压缩后再上传');
    }
    var prefix = options.prefix || 'file';
    var name = prefix + '-' + stamp(new Date()) + '-' + Math.random().toString(36).slice(2, 6) + '.' + extension;
    var base64 = await fileToBase64(file);
    await api('/repos/' + OWNER + '/' + REPO + '/contents/' + folder + '/' + name, {
      method: 'PUT',
      body: {
        message: '上传资源：' + folder + '/' + name,
        content: base64,
        branch: BRANCH
      }
    });
    return folder + '/' + name;
  }

  async function insertArticleImage(file) {
    setStatus($('editorStatus'), '正在上传图片…');
    try {
      var path = await uploadFile(file, 'assets/posts', { prefix: 'img', ext: /^(jpg|jpeg|png|webp|gif|avif|svg)$/ });
      insertMediaHtml('<img src="' + rawUrl(path) + '" alt="插图">');
      setStatus($('editorStatus'), '图片已插入：' + path, 'ok');
    } catch (e) {
      setStatus($('editorStatus'), '图片上传失败：' + friendlyApiError(e), 'err');
    }
  }

  function insertMediaHtml(html) {
    if (sourceMode) {
      insertAtCursor($('postContent'), html);
    } else {
      var editor = $('richEditor');
      editor.focus();
      document.execCommand('insertHTML', false, html);
    }
    dirty = true;
  }

  async function insertVideoFile(file) {
    setStatus($('editorStatus'), '正在上传视频…');
    try {
      var path = await uploadFile(file, 'assets/videos', { prefix: 'video', ext: /^(mp4|webm|mov|m4v)$/ });
      insertMediaHtml('<figure><video controls preload="metadata" src="' + rawUrl(path) + '" style="max-width:100%"></video></figure>');
      setStatus($('editorStatus'), '视频已插入', 'ok');
    } catch (e) {
      setStatus($('editorStatus'), '视频上传失败：' + friendlyApiError(e), 'err');
    }
  }

  async function insertAttachFile(file) {
    setStatus($('editorStatus'), '正在上传资源…');
    try {
      var path = await uploadFile(file, 'assets/files', { prefix: 'file' });
      insertMediaHtml('<p><a class="file-link" href="' + rawUrl(path) + '" download="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '（点击下载）</a></p>');
      setStatus($('editorStatus'), '资源已插入：' + file.name, 'ok');
    } catch (e) {
      setStatus($('editorStatus'), '资源上传失败：' + friendlyApiError(e), 'err');
    }
  }

  function setupTheme() {
    var toggle = $('themeToggle');
    toggle.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('blog-theme', next);
      } catch (e) {
        /* 忽略 */
      }
    });
  }

  function setupEvents() {
    $('connectBtn').addEventListener('click', async function () {
      var input = $('tokenInput').value.trim();
      if (!input) {
        setStatus($('authStatus'), '请先粘贴 Token。', 'err');
        return;
      }
      token = input;
      setStatus($('authStatus'), '正在连接…');
      try {
        await api('/user');
        await fetchPostsMeta();
        saveToken(token);
        showList();
      } catch (e) {
        token = '';
        setStatus($('authStatus'), '连接失败：' + friendlyApiError(e), 'err');
      }
    });

    $('tokenInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') $('connectBtn').click();
    });

    $('logoutBtn').addEventListener('click', function () {
      clearToken();
      token = '';
      postsSha = null;
      try {
        localStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(AUTH_KEY);
      } catch (e) {
        /* 忽略 */
      }
      window.location.href = 'login.html';
    });

    $('newPostBtn').addEventListener('click', function () {
      openEditor(-1);
    });

    $('postList').addEventListener('click', function (event) {
      var editButton = event.target.closest('button[data-edit]');
      if (editButton) {
        openEditor(Number(editButton.dataset.edit));
        return;
      }
      var deleteButton = event.target.closest('button[data-delete]');
      if (deleteButton) deletePost(Number(deleteButton.dataset.delete));
    });

    $('saveBtn').addEventListener('click', savePost);

    $('previewBtn').addEventListener('click', function () {
      var wrap = $('previewWrap');
      if (wrap.hidden) {
        $('previewBody').innerHTML = getEditorContent();
        wrap.hidden = false;
        this.textContent = '收起预览';
      } else {
        wrap.hidden = true;
        this.textContent = '预览';
      }
    });

    $('sourceBtn').addEventListener('click', toggleSourceMode);

    $('settingsToggle').addEventListener('click', function () {
      var meta = $('editorMeta');
      meta.hidden = !meta.hidden;
      this.textContent = meta.hidden ? '设置' : '收起';
    });

    $('backBtn').addEventListener('click', function () {
      if (dirty && !window.confirm('有未保存的修改，确定返回列表？')) return;
      showList();
    });

    $('deleteBtn').addEventListener('click', function () {
      if (editingIndex < 0) {
        setStatus($('editorStatus'), '新文章还没有保存，直接返回列表即可放弃。', 'err');
        return;
      }
      deletePost(editingIndex);
    });

    $('coverFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!token) {
        setStatus($('editorStatus'), '连接 GitHub 后才能上传封面。', 'err');
        return;
      }
      uploadCover(file);
    });

    $('insertImageFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!token) {
        setStatus($('editorStatus'), '连接 GitHub 后才能插入图片。', 'err');
        return;
      }
      insertArticleImage(file);
    });

    $('insertVideoFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!token) {
        setStatus($('editorStatus'), '连接 GitHub 后才能上传视频。', 'err');
        return;
      }
      insertVideoFile(file);
    });

    $('insertAttachFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!token) {
        setStatus($('editorStatus'), '连接 GitHub 后才能上传资源。', 'err');
        return;
      }
      insertAttachFile(file);
    });

    $('pageBtn').addEventListener('click', openPagePanel);
    $('savePageBtn').addEventListener('click', savePageContent);
    $('backPageBtn').addEventListener('click', function () {
      showList();
    });

    $('messageBtn').addEventListener('click', openMessageBox);
    $('msgAddBtn').addEventListener('click', addCommentFromForm);
    $('msgSaveBtn').addEventListener('click', saveComments);
    $('msgBackBtn').addEventListener('click', function () {
      showList();
    });
    $('msgRefreshLikes').addEventListener('click', refreshLikeStats);
    $('msgRefreshPending').addEventListener('click', refreshPendingList);
    $('msgCommentList').addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-del-comment]');
      if (!btn) return;
      var slug = btn.dataset.delSlug;
      var id = btn.dataset.delComment;
      messageComments[slug] = (messageComments[slug] || []).filter(function (item) {
        return item.id !== id;
      });
      renderMessageBox();
      setStatus($('msgStatus'), '已删除，点击“保存并发布”后生效。');
    });

    $('msgPendingList').addEventListener('click', function (event) {
      var approveBtn = event.target.closest('button[data-approve-comment]');
      if (approveBtn) {
        approveBtn.disabled = true;
        approvePendingItem(approveBtn.dataset.approveComment);
        return;
      }
      var delBtn = event.target.closest('button[data-delete-pending]');
      if (delBtn) deletePendingItem(delBtn.dataset.deletePending);
    });

    $('postCover').addEventListener('input', updateCoverPreview);
    $('editorPanel').addEventListener('input', function () {
      dirty = true;
    });

    window.addEventListener('beforeunload', function (event) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  function enterApp() {
    $('repoInfo').textContent = OWNER + '/' + REPO + ' · ' + BRANCH;
    $('pageBtn').disabled = previewMode;
    $('messageBtn').disabled = previewMode;
    if (location.hash === '#messages') openMessageBox();
    if (previewMode) {
      showList();
      setStatus($('listStatus'), '本地预览模式：保存和上传功能未启用。', 'err');
    } else {
      showList();
    }
  }

  async function start() {
    if (!previewMode && !isAuthed()) {
      window.location.replace('login.html');
      return;
    }

    setupTheme();
    setupToolbar();
    setupEvents();

    if (previewMode) {
      enterApp();
      return;
    }

    var stored = readToken();
    if (!stored) {
      showAuth();
      return;
    }

    token = stored;
    try {
      await api('/user');
      await fetchPostsMeta();
      enterApp();
    } catch (e) {
      token = '';
      clearToken();
      showAuth('上次连接已失效，请重新输入 Token。');
    }
  }

  function init() {
    posts = window.BLOG_POSTS || [];
    start();
  }

  if (window.BLOG_POSTS) {
    init();
  } else {
    document.addEventListener('posts-ready', init);
  }
})();
