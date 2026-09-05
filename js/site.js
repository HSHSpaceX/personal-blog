(function () {
  'use strict';

  var posts = window.BLOG_POSTS || [];
  var SITE_NAME = '拾光手记';

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

  function formatDate(value) {
    var date = new Date(value + 'T00:00:00');
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function postUrl(slug) {
    return 'post.html?slug=' + encodeURIComponent(slug);
  }

  function categoryUrl(category) {
    return 'archive.html?category=' + encodeURIComponent(category);
  }

  function tagUrl(tag) {
    return 'archive.html?tag=' + encodeURIComponent(tag);
  }

  function arrowSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  }

  function categoryChip(post) {
    return '<a class="post-category" href="' + categoryUrl(post.category) + '">' + escapeHtml(post.category) + '</a>';
  }

  function renderPostCard(post) {
    return '' +
      '<article class="post-card">' +
        '<a class="post-card-media" href="' + postUrl(post.slug) + '" aria-label="' + escapeHtml(post.title) + '">' +
          '<img src="' + escapeHtml(post.cover) + '" alt="' + escapeHtml(post.title) + '" loading="lazy">' +
        '</a>' +
        '<div class="post-card-body">' +
          categoryChip(post) +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          '<p class="post-card-excerpt">' + escapeHtml(post.excerpt) + '</p>' +
          '<div class="post-card-meta">' +
            '<span class="post-date">' + formatDate(post.date) + '</span>' +
            '<span>' + post.readingTime + ' 分钟</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderFeatured(post) {
    return '' +
      '<article class="featured-card">' +
        '<div class="featured-media">' +
          '<img src="' + escapeHtml(post.cover) + '" alt="' + escapeHtml(post.title) + '">' +
        '</div>' +
        '<div class="featured-content">' +
          categoryChip(post) +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          '<p class="featured-excerpt">' + escapeHtml(post.excerpt) + '</p>' +
          '<span class="post-date">' + formatDate(post.date) + ' · ' + post.readingTime + ' 分钟阅读</span>' +
          '<a class="arrow-link" href="' + postUrl(post.slug) + '">阅读全文 ' + arrowSvg() + '</a>' +
        '</div>' +
      '</article>';
  }

  function renderArchiveRow(post) {
    return '' +
      '<article class="archive-row">' +
        '<a class="archive-thumb" href="' + postUrl(post.slug) + '" aria-label="' + escapeHtml(post.title) + '">' +
          '<img src="' + escapeHtml(post.cover) + '" alt="" loading="lazy">' +
        '</a>' +
        '<div class="archive-row-main">' +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          '<p>' + escapeHtml(post.excerpt) + '</p>' +
        '</div>' +
        '<div class="archive-row-side">' +
          '<span>' + formatDate(post.date) + '</span>' +
          '<span>' + post.readingTime + ' 分钟阅读</span>' +
        '</div>' +
      '</article>';
  }

  function renderHome() {
    if (posts.length === 0) return;

    var featuredEl = document.getElementById('featuredPost');
    var gridEl = document.getElementById('postGrid');
    var statsEl = document.getElementById('introStats');
    var categoryEl = document.getElementById('categoryList');

    var featured = posts.filter(function (post) { return post.featured; })[0] || posts[0];

    if (featuredEl) {
      featuredEl.innerHTML = renderFeatured(featured);
    }

    if (gridEl) {
      var latest = posts.filter(function (post) { return post.slug !== featured.slug; }).slice(0, 3);
      gridEl.innerHTML = latest.map(renderPostCard).join('');
    }

    if (statsEl) {
      var categories = [];
      var latestDate = posts[0].date;
      posts.forEach(function (post) {
        if (categories.indexOf(post.category) === -1) categories.push(post.category);
        if (post.date > latestDate) latestDate = post.date;
      });
      statsEl.innerHTML =
        '<span class="stat"><strong>' + posts.length + '</strong> 篇文章</span>' +
        '<span class="stat"><strong>' + categories.length + '</strong> 个分类</span>' +
        '<span class="stat">更新于 ' + formatDate(latestDate) + '</span>';
    }

    if (categoryEl) {
      var counts = {};
      posts.forEach(function (post) {
        counts[post.category] = (counts[post.category] || 0) + 1;
      });
      categoryEl.innerHTML = Object.keys(counts).map(function (category) {
        return '<a class="category-chip" href="' + categoryUrl(category) + '">' +
          escapeHtml(category) + ' <span class="count">' + counts[category] + '</span></a>';
      }).join('');
    }
  }

  function renderArchive() {
    var listEl = document.getElementById('archiveList');
    var countEl = document.getElementById('resultCount');
    var chipsEl = document.getElementById('filterChips');
    var tagChipsEl = document.getElementById('tagChips');
    var searchInput = document.getElementById('searchInput');
    if (!listEl) return;

    var params = new URLSearchParams(window.location.search);
    var activeCategory = params.get('category') || '全部';
    var activeTag = params.get('tag') || '全部';
    var query = '';

    var categories = ['全部'];
    var tags = ['全部'];
    posts.forEach(function (post) {
      if (categories.indexOf(post.category) === -1) categories.push(post.category);
      (post.tags || []).forEach(function (tag) {
        if (tags.indexOf(tag) === -1) tags.push(tag);
      });
    });

    chipsEl.innerHTML = categories.map(function (category) {
      return '<button type="button" class="filter-chip' + (category === activeCategory ? ' active' : '') + '" data-category="' + escapeHtml(category) + '">' + escapeHtml(category) + '</button>';
    }).join('');

    if (tagChipsEl) {
      tagChipsEl.innerHTML = tags.map(function (tag) {
        return '<button type="button" class="filter-chip' + (tag === activeTag ? ' active' : '') + '" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</button>';
      }).join('');
    }

    function matches(post) {
      var inCategory = activeCategory === '全部' || post.category === activeCategory;
      var inTag = activeTag === '全部' || (post.tags || []).indexOf(activeTag) !== -1;
      var haystack = (post.title + ' ' + post.excerpt + ' ' + post.category + ' ' + post.tags.join(' ')).toLowerCase();
      return inCategory && inTag && haystack.indexOf(query) !== -1;
    }

    function update() {
      var filtered = posts.filter(matches);
      listEl.innerHTML = filtered.length
        ? filtered.map(renderArchiveRow).join('')
        : '<p class="empty-state">没有找到匹配的文章。</p>';
      var label = '共 ' + filtered.length + ' 篇文章';
      if (activeCategory !== '全部') label += ' · 分类：' + activeCategory;
      if (activeTag !== '全部') label += ' · 标签：' + activeTag;
      countEl.textContent = label;
    }

    chipsEl.addEventListener('click', function (event) {
      var chip = event.target.closest('.filter-chip');
      if (!chip) return;
      activeCategory = chip.dataset.category;
      chipsEl.querySelectorAll('.filter-chip').forEach(function (el) {
        el.classList.toggle('active', el === chip);
      });
      update();
    });

    if (tagChipsEl) {
      tagChipsEl.addEventListener('click', function (event) {
        var chip = event.target.closest('.filter-chip');
        if (!chip) return;
        activeTag = chip.dataset.tag;
        tagChipsEl.querySelectorAll('.filter-chip').forEach(function (el) {
          el.classList.toggle('active', el === chip);
        });
        update();
      });
    }

    searchInput.addEventListener('input', function () {
      query = searchInput.value.trim().toLowerCase();
      update();
    });

    update();
  }

  function renderPost() {
    var titleEl = document.getElementById('postTitle');
    if (!titleEl) return;

    var params = new URLSearchParams(window.location.search);
    var slug = params.get('slug');
    var post = posts.filter(function (item) { return item.slug === slug; })[0];

    if (!post) {
      document.title = '未找到文章 - ' + SITE_NAME;
      titleEl.textContent = '未找到这篇文章';
      var contentEl = document.getElementById('postContent');
      if (contentEl) contentEl.innerHTML = '<p>文章可能已被移动或删除，请返回归档页继续浏览。</p>';
      var coverEl = document.getElementById('postCover');
      if (coverEl) coverEl.style.display = 'none';
      return;
    }

    document.title = post.title + ' - ' + SITE_NAME;
    titleEl.textContent = post.title;
    document.getElementById('postCategory').innerHTML = '<a class="crumb-link" href="' + categoryUrl(post.category) + '">' + escapeHtml(post.category) + '</a> · ' + formatDate(post.date);
    document.getElementById('postDate').textContent = formatDate(post.date);
    document.getElementById('postReading').textContent = post.readingTime + ' 分钟阅读';
    document.getElementById('postTags').innerHTML = post.tags.map(function (tag) {
      return '<a class="tag-chip" href="' + tagUrl(tag) + '">' + escapeHtml(tag) + '</a>';
    }).join('');

    var cover = document.getElementById('postCover');
    cover.src = post.cover;
    cover.alt = post.title;

    document.getElementById('postContent').innerHTML = post.content;

    var index = posts.indexOf(post);
    var prev = index > 0 ? posts[index - 1] : null;
    var next = index < posts.length - 1 ? posts[index + 1] : null;

    var prevEl = document.getElementById('prevPost');
    var nextEl = document.getElementById('nextPost');
    if (prevEl) {
      if (prev) {
        prevEl.href = postUrl(prev.slug);
        prevEl.innerHTML = '<span class="post-nav-label">上一篇</span><span class="post-nav-title">' + escapeHtml(prev.title) + '</span>';
      } else {
        prevEl.style.display = 'none';
      }
    }
    if (nextEl) {
      if (next) {
        nextEl.classList.add('next');
        nextEl.href = postUrl(next.slug);
        nextEl.innerHTML = '<span class="post-nav-label">下一篇</span><span class="post-nav-title">' + escapeHtml(next.title) + '</span>';
      } else {
        nextEl.style.display = 'none';
      }
    }
  }

  function setupReadingProgress() {
    var bar = document.getElementById('progressBar');
    if (!bar) return;

    function update() {
      var total = document.documentElement.scrollHeight - window.innerHeight;
      var percent = total > 0 ? (window.scrollY / total) * 100 : 0;
      bar.style.width = percent + '%';
    }

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function setupTheme() {
    var toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    function readTheme() {
      try {
        return localStorage.getItem('blog-theme') || 'light';
      } catch (e) {
        return 'light';
      }
    }

    function writeTheme(value) {
      try {
        localStorage.setItem('blog-theme', value);
      } catch (e) {
        /* 某些环境下本地存储不可用，仅本次生效 */
      }
    }

    function applyLabel() {
      var dark = document.documentElement.dataset.theme === 'dark';
      toggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换深色模式');
      toggle.setAttribute('title', dark ? '切换到浅色模式' : '切换深色模式');
    }

    applyLabel();
    toggle.addEventListener('click', function () {
      var next = readTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      writeTheme(next);
      applyLabel();
    });
  }

  function setupMenu() {
    var toggle = document.getElementById('menuToggle');
    var nav = document.getElementById('siteNav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  renderHome();
  renderArchive();
  renderPost();
  setupReadingProgress();
  setupTheme();
  setupMenu();
})();
