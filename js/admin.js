(function () {
  'use strict';

  var OWNER = 'HSHSpaceX';
  var REPO = 'personal-blog';
  var BRANCH = 'main';
  var POSTS_PATH = 'js/posts.js';
  var API_ROOT = 'https://api.github.com';
  var TOKEN_KEY = 'blog-gh-token';
  var AUTH_KEY = 'blog-auth';

  var posts = window.BLOG_POSTS || [];
  var postsSha = null;
  var token = '';
  var editingIndex = -1;
  var isNewPost = false;
  var dirty = false;
  var previewMode = new URLSearchParams(window.location.search).has('preview');

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
      return sessionStorage.getItem(AUTH_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setStatus(el, message, kind) {
    el.textContent = message;
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
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

  async function commitPosts(message) {
    var body = {
      message: message,
      content: toBase64(serializePosts()),
      branch: BRANCH
    };
    if (postsSha) body.sha = postsSha;
    var data = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + POSTS_PATH, {
      method: 'PUT',
      body: body
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
    $('authPanel').hidden = false;
    $('appPanel').hidden = true;
    $('editorPanel').hidden = true;
    setStatus($('authStatus'), message || '', kind);
  }

  function showList() {
    $('authPanel').hidden = true;
    $('appPanel').hidden = false;
    $('editorPanel').hidden = true;
    renderList();
  }

  function showEditor() {
    $('authPanel').hidden = true;
    $('appPanel').hidden = true;
    $('editorPanel').hidden = false;
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
    $('postContent').value = post.content || '<p></p>';

    fillDatalists();
    updateCoverPreview();
    $('previewWrap').hidden = true;
    $('previewBtn').textContent = '预览';
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
      content: $('postContent').value.trim() || '<p></p>'
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
        setStatus($('editorStatus'), '保存失败：' + e.message, 'err');
      }
    }
  }

  async function deletePost(index) {
    var post = posts[index];
    if (!post) return;
    if (!window.confirm('确定删除《' + post.title + '》？删除会直接提交到 GitHub。')) return;
    posts.splice(index, 1);
    setStatus($('listStatus'), '正在删除…');
    try {
      await commitPosts('删除文章：' + post.title);
      setStatus($('listStatus'), '已删除并提交，GitHub Pages 将在一两分钟内自动发布。', 'ok');
    } catch (e) {
      posts.splice(index, 0, post);
      setStatus($('listStatus'), '删除失败：' + e.message, 'err');
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

  function setupToolbar() {
    var tools = [
      ['H2', '<h2>小标题</h2>'],
      ['粗体', '<strong>加粗文字</strong>'],
      ['斜体', '<em>斜体文字</em>'],
      ['引用', '<blockquote><p>引用的话</p></blockquote>'],
      ['列表', '<ul>\n  <li>列表项</li>\n</ul>'],
      ['代码', '<pre><code>code here</code></pre>'],
      ['链接', '<a href="https://example.com">链接文字</a>'],
      ['图片', '<img src="assets/covers/xxx.jpg" alt="描述">']
    ];
    var toolbar = $('contentToolbar');
    toolbar.innerHTML = tools.map(function (tool, index) {
      return '<button type="button" class="btn" data-tool="' + index + '">' + escapeHtml(tool[0]) + '</button>';
    }).join('');
    toolbar.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-tool]');
      if (!button) return;
      insertAtCursor($('postContent'), tools[Number(button.dataset.tool)][1]);
    });
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
    var extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
    if (!/^(jpg|jpeg|png|webp|gif|avif|svg)$/.test(extension)) extension = 'jpg';
    var name = 'cover-' + stamp(new Date()) + '.' + extension;
    setStatus($('editorStatus'), '正在上传封面…');
    try {
      var base64 = await fileToBase64(file);
      await api('/repos/' + OWNER + '/' + REPO + '/contents/assets/covers/' + name, {
        method: 'PUT',
        body: {
          message: '上传封面：' + name,
          content: base64,
          branch: BRANCH
        }
      });
      $('postCover').value = 'assets/covers/' + name;
      updateCoverPreview();
      setStatus($('editorStatus'), '封面上传成功：' + name, 'ok');
    } catch (e) {
      setStatus($('editorStatus'), '封面上传失败：' + e.message, 'err');
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
        setStatus($('authStatus'), '连接失败：' + e.message, 'err');
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
        $('previewBody').innerHTML = $('postContent').value;
        wrap.hidden = false;
        this.textContent = '收起预览';
      } else {
        wrap.hidden = true;
        this.textContent = '预览';
      }
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

  start();
})();
