(function () {
  'use strict';

  var OWNER = window.BlogConfig.GITHUB_OWNER;
  var REPO = window.BlogConfig.GITHUB_REPO;
  var BRANCH = 'main';
  var POSTS_PATH = 'js/posts.js';
  var CONTENT_PATH = 'js/content.js';
  var API_ROOT = 'https://api.github.com';
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
    { label: '视频', cmd: 'insertLocalVideo', snippet: '<video controls playsinline webkit-playsinline preload="metadata" src="assets/videos/xxx.mp4"></video>' },
    { label: '资源', cmd: 'insertLocalFile', snippet: '<p><a href="assets/files/xxx.zip" download>资源下载</a></p>' },
    { label: '公式', cmd: 'insertFormula', snippet: '$$公式$$' }
  ];

  var moderationRows = [];

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

  function readToken() { return window.GitHubCredentials.get(); }
  function clearToken() { window.GitHubCredentials.clear(); }
  function isAuthed() { return window.BlogAuth.isAdmin(); }

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
      Authorization: 'Bearer ' + readToken(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async function api(path, options) {
    window.BlogAuth.requireAdmin();
    if (!readToken()) throw new Error('请在当前页面重新连接 GitHub PAT。');
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

  async function removePostContent(slug) {
    var path = 'posts/' + encodeURIComponent(slug) + '.html';
    try {
      var data = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + path + '?ref=' + BRANCH);
      await api('/repos/' + OWNER + '/' + REPO + '/contents/' + path, {
        method: 'DELETE',
        body: { message: '删除文章页面：' + slug, sha: data.sha, branch: BRANCH }
      });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
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
    if (!readToken()) {
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
    showMessage();
    refreshModeration();
    refreshLikeStats();
    window.scrollTo({ top: 0 });
  }
  async function refreshModeration() {
    try {
      moderationRows = await window.BlogData.listModeration();
      var pending = moderationRows.filter(function (r) { return r.status === 'pending'; });
      var reviewed = moderationRows.filter(function (r) { return r.status !== 'pending'; });
      $('msgPendingList').innerHTML = pending.length ? pending.map(renderPendingItem).join('') : '<p class="empty-state">没有待审核的评论。</p>';
      $('msgCommentList').innerHTML = reviewed.length ? reviewed.map(renderMsgItem).join('') : '<p class="empty-state">暂无已审核评论。</p>';
      $('pendingCount').hidden = !pending.length;
      $('pendingCount').textContent = String(pending.length);
    } catch (error) { setStatus($('msgStatus'), '读取评论失败：' + error.message, 'err'); }
  }
  function renderMsgItem(item) {
    return '<div class="msg-item"><div class="msg-item-head"><strong>' + escapeHtml(item.legacy_author_name || item.user_id || '用户') +
      '</strong><span>' + escapeHtml(item.post_slug) + ' · ' + escapeHtml(item.created_at.slice(0, 10)) + ' · ' + escapeHtml(item.status) +
      '</span></div><p class="msg-item-content">' + escapeHtml(item.content) + '</p><div class="msg-item-actions">' +
      '<button type="button" class="btn danger" data-del-comment="' + escapeHtml(item.id) + '">删除</button></div></div>';
  }
  function renderPendingItem(item) {
    return '<div class="msg-item"><div class="msg-item-head"><strong>' + escapeHtml(item.legacy_author_name || item.user_id || '用户') +
      '</strong><span>' + escapeHtml(item.post_slug) + ' · ' + escapeHtml(item.created_at.slice(0, 10)) +
      '</span></div><p class="msg-item-content">' + escapeHtml(item.content) + '</p><div class="msg-item-actions">' +
      '<label>拒绝原因（必填）<textarea maxlength="2000" data-comment-rejection="'+escapeHtml(item.id)+'"></textarea></label>' +
      '<button type="button" class="btn primary" data-approve-comment="' + escapeHtml(item.id) + '">通过</button>' +
      '<button type="button" class="btn" data-reject-comment="' + escapeHtml(item.id) + '">拒绝</button>' +
      '<button type="button" class="btn danger" data-delete-pending="' + escapeHtml(item.id) + '">删除</button></div></div>';
  }
  function refreshPendingList() { return refreshModeration(); }
  async function approvePendingItem(id) {
    try { var item=moderationRows.find(function(r){return r.id===id;});await window.BlogData.moderateComment(id, 'approved',null,item&&item.content); await refreshModeration(); setStatus($('msgStatus'), '评论已通过。', 'ok'); }
    catch (error) { setStatus($('msgStatus'), error.message, 'err'); }
  }
  async function rejectPendingItem(id) {
    try { var reasonInput=document.querySelector('[data-comment-rejection="'+id+'"]');if(!reasonInput||!reasonInput.value.trim())throw Error('拒绝必须填写原因。');await window.BlogData.moderateComment(id, 'rejected',reasonInput&&reasonInput.value.trim(),(moderationRows.find(function(r){return r.id===id;})||{}).content); await refreshModeration(); setStatus($('msgStatus'), '评论已拒绝。', 'ok'); }
    catch (error) { setStatus($('msgStatus'), error.message, 'err'); }
  }
  async function deletePendingItem(id) {
    try { await window.BlogData.deleteComment(id); await refreshModeration(); setStatus($('msgStatus'), '评论已删除。', 'ok'); }
    catch (error) { setStatus($('msgStatus'), error.message, 'err'); }
  }
  async function refreshLikeStats() {
    var el = $('msgLikes');
    try {
      var slugs = posts.map(function (post) { return post.slug; });
      var rows = await window.BlogData.likes('post', slugs);
      el.innerHTML = slugs.map(function (slug) {
        return '<div class="msg-like-row"><span>' + escapeHtml(slug) + '</span><strong>' + ((rows[slug] && rows[slug].count) || 0) + ' 个赞</strong></div>';
      }).join('');
    } catch (error) { el.textContent = '点赞读取失败：' + error.message; }
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
    var FIXED_CATEGORIES = ['火箭部件', '飞控制作', '软件设计', '嵌入式', 'AI', '3D打印', '人文历史', '艺术创作', '杂谈'];
    var merged = FIXED_CATEGORIES.concat(categories.filter(function (c) { return FIXED_CATEGORIES.indexOf(c) === -1; }));
    $('categoryOptions').innerHTML = merged.map(function (category) {
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
    if (!readToken()) {
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
      await removePostContent(post.slug);
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
      if (window.ResourceManager) {
        window.ResourceManager.open(function (r) {
          insertMediaHtml('<img src="' + r.path + '" alt="插图">');
        });
      } else {
        $('insertImageFile').click();
      }
      return;
    } else if (tool.cmd === 'insertLocalVideo') {
      if (window.ResourceManager) {
        window.ResourceManager.open(function (r) {
          if (r.path.match(/\.(mp4|mov|webm)$/i)) {
            insertMediaHtml('<figure><video controls playsinline preload="metadata" src="' + r.path + '" style="max-width:100%"></video></figure>');
          } else {
            insertMediaHtml('<img src="' + r.path + '" alt="插图">');
          }
        });
      } else {
        $('insertVideoFile').click();
      }
      return;
    } else if (tool.cmd === 'insertLocalFile') {
      if (window.ResourceManager) {
        window.ResourceManager.open(function (r) {
          insertMediaHtml('<p><a class="file-link" href="' + r.path + '" download="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '（点击下载）</a></p>');
        });
      } else {
        $('insertAttachFile').click();
      }
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
      insertMediaHtml('<figure><video controls playsinline webkit-playsinline preload="metadata" src="' + rawUrl(path) + '" style="max-width:100%"></video></figure>');
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

  function setupEvents() {
    $('connectBtn').addEventListener('click', async function () {
      var input = $('tokenInput').value.trim();
      if (!input) {
        setStatus($('authStatus'), '请先粘贴 Token。', 'err');
        return;
      }
      setStatus($('authStatus'), '正在连接…');
      try {
        await window.GitHubCredentials.connect(input);
        await fetchPostsMeta();
        $('tokenInput').value = '';
        showList();
      } catch (e) {
        clearToken();
        setStatus($('authStatus'), '连接失败：' + friendlyApiError(e), 'err');
      } finally { $('tokenInput').value = ''; }
    });

    $('tokenInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') $('connectBtn').click();
    });

    $('logoutBtn').addEventListener('click', async function () {
      clearToken();
      postsSha = null;
      try { await window.BlogAuth.signOut(); window.location.href = 'login.html'; }
      catch (error) { setStatus($('listStatus'), '退出失败：' + error.message, 'err'); }
    });
    $('reviewWithoutPat').addEventListener('click', openMessageBox);

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
      if (!readToken()) {
        setStatus($('editorStatus'), '连接 GitHub 后才能上传封面。', 'err');
        return;
      }
      uploadCover(file);
    });

    $('insertImageFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!readToken()) {
        setStatus($('editorStatus'), '连接 GitHub 后才能插入图片。', 'err');
        return;
      }
      insertArticleImage(file);
    });

    $('insertVideoFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!readToken()) {
        setStatus($('editorStatus'), '连接 GitHub 后才能上传视频。', 'err');
        return;
      }
      insertVideoFile(file);
    });

    $('insertAttachFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      if (!readToken()) {
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
    $('resourceBtn').addEventListener('click', function () {
      if (window.ResourceManager) {
        window.ResourceManager.open();
      }
    });
    $('msgBackBtn').addEventListener('click', function () {
      showList();
    });
    $('msgRefreshLikes').addEventListener('click', refreshLikeStats);
    $('msgRefreshPending').addEventListener('click', refreshPendingList);
    $('msgCommentList').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-del-comment]');
      if (btn) deletePendingItem(btn.dataset.delComment);
    });
    $('msgPendingList').addEventListener('click', function (event) {
      var approve = event.target.closest('[data-approve-comment]');
      var reject = event.target.closest('[data-reject-comment]');
      var remove = event.target.closest('[data-delete-pending]');
      if (approve) approvePendingItem(approve.dataset.approveComment);
      else if (reject) rejectPendingItem(reject.dataset.rejectComment);
      else if (remove) deletePendingItem(remove.dataset.deletePending);
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
    try {
      await window.BlogAuth.ready();
      if (!isAuthed()) { window.location.replace(window.BlogAuth.user() ? 'profile.html' : 'login.html?next=admin.html'); return; }
      window.BlogTheme.setup(); setupToolbar(); setupEvents();
      if (previewMode) { enterApp(); return; }
      if (!readToken()) {
        if (location.hash === '#messages') openMessageBox();
        else showAuth();
        return;
      }
      await window.GitHubCredentials.validate(readToken());
      await fetchPostsMeta();
      enterApp();
    } catch (error) {
      clearToken();
      showAuth('连接已失效：' + error.message, 'err');
    }
  }

  function init() {
    posts = window.BLOG_POSTS || [];
    start();
  }

  window.addEventListener('pageshow', function (event) {
    if (event.persisted && isAuthed() && !readToken()) showAuth('页面已恢复，请重新连接 GitHub PAT。');
  });

  if (window.BLOG_POSTS) {
    init();
  } else {
    document.addEventListener('posts-ready', init);
  }
})();
