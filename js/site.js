(function () {
  'use strict';

  var posts = window.BLOG_POSTS || [];
  var SITE_NAME = '拾光手记';
  var AUTH_KEY = 'blog-auth';

  function isAuthed() {
    try {
      var until = Number(localStorage.getItem(AUTH_KEY) || 0);
      return until > Date.now();
    } catch (e) {
      return false;
    }
  }

  function applyAuthUi() {
    var authed = isAuthed();
    var reader = window.ReaderAccount ? window.ReaderAccount.load() : null;
    document.querySelectorAll('.btn-login').forEach(function (el) {
      el.hidden = authed;
    });
    document.querySelectorAll('.user-menu-wrap').forEach(function (el) {
      el.hidden = !authed;
    });
    // 读者已登录时头像换成自己的
    if (!authed && reader && reader.name && reader.avatar) {
      document.querySelectorAll('.user-avatar img').forEach(function (img) {
        img.src = reader.avatar;
      });
    }
    if (!authed) closeUserMenus();
  }

  function closeUserMenus() {
    document.querySelectorAll('.user-menu').forEach(function (el) {
      el.hidden = true;
    });
    document.querySelectorAll('.user-avatar').forEach(function (el) {
      el.setAttribute('aria-expanded', 'false');
    });
  }

  function setupUserMenu() {
    document.querySelectorAll('.user-avatar').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var menu = btn.parentElement.querySelector('.user-menu');
        if (!menu) return;
        var open = menu.hidden;
        closeUserMenus();
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      });
    });
    document.querySelectorAll('[data-logout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        try {
          localStorage.removeItem(AUTH_KEY);
          localStorage.removeItem('blog-gh-token');
          sessionStorage.removeItem('blog-auth');
        } catch (e) {
          /* 忽略 */
        }
        applyAuthUi();
      });
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.user-menu-wrap')) closeUserMenus();
    });
  }

  function updateFavicon() {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    var image = new Image();
    image.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        var context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        if (document.documentElement.dataset.theme !== 'dark') {
          var data = context.getImageData(0, 0, canvas.width, canvas.height);
          var px = data.data;
          for (var i = 0; i < px.length; i += 4) {
            px[i] = 255 - px[i];
            px[i + 1] = 255 - px[i + 1];
            px[i + 2] = 255 - px[i + 2];
          }
          context.putImageData(data, 0, 0);
        }
        link.href = canvas.toDataURL('image/png');
      } catch (e) {
        /* 忽略 */
      }
    };
    image.src = 'assets/icon.jpg';
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
          '<img src="' + escapeHtml(post.cover) + '" alt="' + escapeHtml(post.title) + '" loading="eager" decoding="async" fetchpriority="high">' +
        '</a>' +
        '<div class="post-card-body">' +
          categoryChip(post) +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          (post.excerpt ? '<p class="post-card-excerpt">' + escapeHtml(post.excerpt) + '</p>' : '') +
          '<div class="post-card-meta">' +
            '<span class="post-date">' + formatDate(post.date) + '</span>' +
            '<span>' + post.readingTime + ' 分钟</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderFeatured(post) {
    return renderRailCard(post, 0);
  }

  function renderRailCard(post, index) {
    return '' +
      '<article class="rail-card reveal" style="transition-delay:' + ((index % 4) * 70) + 'ms">' +
        '<a class="rail-card-media" href="' + postUrl(post.slug) + '" aria-label="' + escapeHtml(post.title) + '">' +
          '<img src="' + escapeHtml(post.cover) + '" alt="" loading="eager" decoding="async" fetchpriority="high">' +
        '</a>' +
        '<div class="rail-card-body">' +
          categoryChip(post) +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          (post.excerpt ? '<p class="rail-card-excerpt">' + escapeHtml(post.excerpt) + '</p>' : '') +
          '<div class="rail-card-meta">' +
            '<span>' + formatDate(post.date) + '</span>' +
            '<span>' + post.readingTime + ' 分钟</span>' +
          '</div>' +
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

    var gridEl = document.getElementById('postGrid');
    var statsEl = document.getElementById('introStats');
    var categoryEl = document.getElementById('categoryList');

    var sorted = posts.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    });

    var railEl = document.getElementById('featuredRail');
    if (railEl) {
      var featured = sorted.slice(0, 4);
      railEl.innerHTML = featured.map(renderRailCard).join('');
    }

    if (gridEl) {
      gridEl.innerHTML = sorted.slice(0, 9).map(renderPostCard).join('');
      var latestMoreEl = document.getElementById('latestMore');
      if (latestMoreEl) {
        latestMoreEl.innerHTML = sorted.length > 9
          ? '<a class="text-link" href="archive.html">查看更多' + arrowSvg() + '</a>'
          : '';
      }
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

    var homeCommentsEl = document.getElementById('homeComments');
    if (homeCommentsEl) {
      var allComments = [];
      var commentData = window.SITE_COMMENTS || {};
      Object.keys(commentData).forEach(function (slug) {
        (commentData[slug] || []).forEach(function (item) {
          allComments.push(Object.assign({ slug: slug }, item));
        });
      });
      allComments.sort(function (a, b) {
        return String(b.time || '').localeCompare(String(a.time || ''));
      });
      var latestComments = allComments.slice(0, 9);
      var commentsBand = homeCommentsEl.closest('.band');
      if (!latestComments.length) {
        if (commentsBand) commentsBand.hidden = true;
      } else {
        if (commentsBand) commentsBand.hidden = false;
        homeCommentsEl.innerHTML = latestComments.map(function (item) {
          var post = posts.filter(function (entry) { return entry.slug === item.slug; })[0];
          var source;
          var link;
          if (item.slug === 'about') {
            source = '关于';
            link = 'about.html#commentsSection';
          } else if (item.slug.indexOf('moment-') === 0) {
            source = '动态';
            link = 'moments.html#' + item.slug;
          } else {
            source = post ? post.title : item.slug;
            link = postUrl(item.slug) + '#commentsSection';
          }
          return '<a class="home-comment-card" href="' + escapeHtml(link) + '">' +
            '<p class="home-comment-text">' + escapeHtml(item.content) + '</p>' +
            '<div class="home-comment-meta"><strong>' + escapeHtml(item.nick) + '</strong><span>' + escapeHtml(item.time || '') + ' · ' + escapeHtml(source) + '</span></div>' +
          '</a>';
        }).join('');
      }
    }
  }

  function renderArchive() {
    var listEl = document.getElementById('archiveList');
    var countEl = document.getElementById('resultCount');
    var chipsEl = document.getElementById('filterChips');
    var tagChipsEl = document.getElementById('tagChips');
    var searchInput = document.getElementById('searchInput');
    if (!listEl) return;

    // 5大分类框,9小类归入其中,点开进入对应筛选
    var CATEGORY_GROUPS = [
      { key: '火箭', icon: '🚀', subs: ['火箭部件', '飞控制作'] },
      { key: '开发', icon: '💻', subs: ['软件设计', '嵌入式'] },
      { key: '科技', icon: '🔬', subs: ['AI', '3D打印'] },
      { key: '文艺', icon: '📚', subs: ['人文历史', '艺术创作'] },
      { key: '新闻时报', icon: '📰', subs: [] }
    ];
    var catWrap = document.getElementById('archiveCategories');
    if (catWrap) {
      var counts2 = {};
      posts.forEach(function (p) {
        counts2[p.category] = (counts2[p.category] || 0) + 1;
      });
      var commentCounts2 = {};
      var allComments2 = window.SITE_COMMENTS || {};
      posts.forEach(function (p) {
        var cs = allComments2[p.slug] || [];
        commentCounts2[p.category] = (commentCounts2[p.category] || 0) + cs.length;
      });
      catWrap.innerHTML = '<div class="cat-group-grid">' + CATEGORY_GROUPS.map(function (group) {
        var subs = group.subs || [];
        var allCats = subs.concat([group.key]);
        var total = allCats.reduce(function (sum, c) { return sum + (counts2[c] || 0); }, 0);
        var newReplies = allCats.reduce(function (sum, c) { return sum + (commentCounts2[c] || 0); }, 0);
        var subsHtml = subs.map(function (sub) {
          return '<button class="cat-sub-link" type="button" data-cat="' + escapeHtml(sub) + '">' + escapeHtml(sub) + '</button>';
        }).join('');
        return '<div class="cat-group-card" data-cat-group="' + escapeHtml(group.key) + '">' +
          '<div class="cat-group-head">' +
            '<span class="cat-group-icon">' + group.icon + '</span>' +
            '<div>' +
              '<strong>' + escapeHtml(group.key) + '</strong>' +
              '<span class="cat-group-total">' + total + ' 篇</span>' +
            '</div>' +
            (newReplies > 0 ? '<span class="cat-card-new">' + newReplies + ' 条新评论</span>' : '') +
          '</div>' +
          (subsHtml ? '<div class="cat-group-subs">' + subsHtml + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
      catWrap.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-cat]');
        if (btn) {
          window.location.href = 'archive.html?category=' + encodeURIComponent(btn.getAttribute('data-cat'));
          return;
        }
        var card = event.target.closest('[data-cat-group]');
        if (!card) return;
        window.location.href = 'archive.html?category=' + encodeURIComponent(card.getAttribute('data-cat-group'));
      });
    }

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

      // 未选择分类时隐藏搜索/筛选工具区,只显示分类卡片
      var archiveTools = document.querySelector('.archive-tools');
      if (archiveTools) {
        archiveTools.style.display = activeCategory === '全部' && activeTag === '全部' ? 'none' : '';
      }

      var PAGE_SIZE = 100;
      var page = 0;
      function renderPage() {
        var slice = filtered.slice(0, (page + 1) * PAGE_SIZE);
        listEl.innerHTML = slice.length
          ? slice.map(renderArchiveRow).join('')
          : '<p class="empty-state">没有找到匹配的文章。</p>';
        var moreBtn = document.getElementById('archiveMore');
        if (!moreBtn) {
          moreBtn = document.createElement('div');
          moreBtn.id = 'archiveMore';
          moreBtn.style.cssText = 'text-align:center;margin-top:20px';
          listEl.after(moreBtn);
        }
        if (slice.length < filtered.length) {
          moreBtn.innerHTML = '<button class="btn" type="button">查看更多（剩余 ' + (filtered.length - slice.length) + ' 篇）</button>';
          moreBtn.querySelector('button').addEventListener('click', function () {
            page += 1;
            renderPage();
          });
        } else {
          moreBtn.innerHTML = '';
        }
      }
      renderPage();
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

  function renderTimeline() {
    var listEl = document.getElementById('timelineList');
    if (!listEl) return;

    if (posts.length === 0) {
      listEl.innerHTML = '<p class="empty-state">还没有文章。</p>';
      return;
    }

    var sorted = posts.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    });
    var years = [];
    var byYear = {};
    sorted.forEach(function (post) {
      var year = String(post.date).slice(0, 4);
      if (!byYear[year]) {
        byYear[year] = [];
        years.push(year);
      }
      byYear[year].push(post);
    });

    listEl.innerHTML = years.map(function (year) {
      var months = [];
      var byMonth = {};
      byYear[year].forEach(function (post) {
        var month = String(post.date).slice(5, 7);
        if (!byMonth[month]) {
          byMonth[month] = [];
          months.push(month);
        }
        byMonth[month].push(post);
      });
      return '<section class="timeline-year">' +
        '<h2>' + escapeHtml(year) + '</h2>' +
        months.map(function (month) {
          return '<div class="timeline-month">' +
            '<span class="timeline-month-label">' + parseInt(month, 10) + ' 月</span>' +
            byMonth[month].map(function (post) {
              return '<a class="timeline-item" href="' + postUrl(post.slug) + '">' +
                '<span class="timeline-item-title">' + escapeHtml(post.title) + '</span>' +
                '<span class="timeline-item-meta">' + formatDate(post.date) + ' · ' + escapeHtml(post.category) + '</span>' +
              '</a>';
            }).join('') +
          '</div>';
        }).join('') +
      '</section>';
    }).join('');
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
      var commentsEl = document.getElementById('commentsSection');
      if (commentsEl) commentsEl.hidden = true;
      var asideEl = document.querySelector('.post-aside');
      if (asideEl) asideEl.hidden = true;
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

    document.getElementById('postContent').innerHTML = post.content;
    document.getElementById('postContent').querySelectorAll('img').forEach(function (img) {
      img.setAttribute('decoding', 'async');
      img.setAttribute('loading', 'eager');
    });
    document.getElementById('postContent').querySelectorAll('video').forEach(function (video) {
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.addEventListener('error', function () {
        if (video.nextElementSibling && video.nextElementSibling.classList.contains('video-fallback')) return;
        var tip = document.createElement('p');
        tip.className = 'video-fallback';
        tip.innerHTML = '视频无法在当前设备播放？<a href="' + escapeHtml(video.src) + '" target="_blank" rel="noopener">点此打开原视频</a>';
        video.after(tip);
      });
    });
    renderMathIn(document.getElementById('postContent'));
    enhanceCodeBlocks(document.getElementById('postContent'));
    SiteLightbox.watch(document.getElementById('postContent'));
    buildToc();
    initLikes(post.slug);
    var section = document.getElementById('commentsSection');
    if (section) section.dataset.slug = post.slug;

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
      updateFavicon();
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

  function setupReveal() {
    var reduceMotion = false;
    try {
      reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      /* 忽略 */
    }
    if (reduceMotion || !('IntersectionObserver' in window)) return;

    var selectors = [
      '#featuredPost .featured-card',
      '.section-head',
      '#postGrid .post-card',
      '#featuredRail .rail-card',
      '#homeComments .home-comment-card',
      '.category-list .category-chip',
      '.about-inner',
      '#archiveList .archive-row',
      '#timelineList .timeline-year'
    ];
    var targets = [];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (el, index) {
        el.classList.add('reveal');
        el.style.transitionDelay = Math.min((index % 6) * 70, 350) + 'ms';
        targets.push(el);
      });
    });
    if (targets.length === 0) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add('in');
        observer.unobserve(el);
        window.setTimeout(function () {
          el.classList.remove('reveal');
          el.classList.remove('in');
          el.style.transitionDelay = '';
        }, 1100);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    targets.forEach(function (el) {
      observer.observe(el);
    });

    // 兜底:4 秒后仍未显示的内容直接显示,防止任何情况下板块一直透明
    window.setTimeout(function () {
      targets.forEach(function (el) {
        if (el.classList.contains('reveal') && !el.classList.contains('in')) {
          el.classList.add('in');
          observer.unobserve(el);
          window.setTimeout(function () {
            el.classList.remove('reveal');
            el.classList.remove('in');
            el.style.transitionDelay = '';
          }, 1100);
        }
      });
    }, 4000);
  }

  function applyContent() {
    var content = window.SITE_CONTENT || {};
    if (content.siteName) {
      document.querySelectorAll('.brand-name').forEach(function (el) {
        el.textContent = content.siteName;
      });
    }
    var introTitle = document.getElementById('introTitle');
    if (introTitle && content.introTitle) introTitle.textContent = content.introTitle;
    var introText = document.getElementById('introText');
    if (introText && content.introText) introText.textContent = content.introText;
    var aboutTitle = document.getElementById('aboutTitle');
    if (aboutTitle && content.aboutTitle) aboutTitle.textContent = content.aboutTitle;
    var aboutText = document.getElementById('aboutText');
    if (aboutText && content.aboutText) aboutText.textContent = content.aboutText;
    var aboutProse = document.getElementById('aboutProse');
    if (aboutProse && content.aboutPage) aboutProse.innerHTML = content.aboutPage;
    if (aboutProse) renderMathIn(aboutProse);
  }

  function renderMathIn(el) {
    if (!el || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  function buildToc() {
    var toc = document.getElementById('toc');
    var content = document.getElementById('postContent');
    if (!toc || !content) return;
    var heads = content.querySelectorAll('h2, h3');
    var card = toc.closest('.aside-card');
    if (heads.length === 0) {
      if (card) card.style.display = 'none';
      return;
    }
    var html = '';
    heads.forEach(function (head, index) {
      var id = 'sec-' + index;
      head.id = id;
      html += '<a class="toc-link toc-' + head.tagName.toLowerCase() + '" href="#' + id + '">' + escapeHtml(head.textContent) + '</a>';
    });
    toc.innerHTML = html;
  }

  function enhanceCodeBlocks(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach(function (pre) {
      if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'code-block-wrap';
      pre.before(wrap);
      wrap.appendChild(pre);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = '复制';
      btn.addEventListener('click', function () {
        var text = pre.innerText;
        function markCopied() {
          btn.textContent = '已复制';
          btn.classList.add('copied');
          window.setTimeout(function () {
            btn.textContent = '复制';
            btn.classList.remove('copied');
          }, 1600);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(markCopied).catch(function () {
            fallbackCopy(text);
            markCopied();
          });
        } else {
          fallbackCopy(text);
          markCopied();
        }
      });
      wrap.appendChild(btn);
    });
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      /* 忽略 */
    }
    textarea.remove();
  }

  function initLikes(slug) {
    var btn = document.getElementById('likeBtn');
    var countEl = document.getElementById('likeCount');
    if (!btn || !countEl) return;
    var key = 'blog-liked-' + slug;
    var countKey = 'blog-like-count-' + slug;
    var queueKey = 'blog-like-queue';
    var liked = false;
    var lastCount = null;
    try {
      liked = localStorage.getItem(key) === '1';
      lastCount = Number(localStorage.getItem(countKey));
      if (isNaN(lastCount)) lastCount = null;
    } catch (e2) {
      liked = false;
      lastCount = null;
    }

    function persistCount(count) {
      if (typeof count !== 'number' || isNaN(count)) return;
      lastCount = count;
      try {
        localStorage.setItem(countKey, String(count));
      } catch (e3) {
        /* 忽略 */
      }
    }

    function render(count) {
      persistCount(count);
      countEl.textContent = lastCount === null ? '—' : String(lastCount);
      btn.classList.toggle('liked', liked);
      btn.disabled = false;
      btn.setAttribute('aria-label', liked ? '取消点赞' : '点赞这篇文章');
    }

    function fetchLikeCount() {
      return fetchLikeDiff(slug);
    }

    render(lastCount);
    fetchLikeCount().then(function (count) {
      if (count !== null) render(count);
    });

    btn.dataset.likeSlug = slug;
    if (!likeHandlerBound) {
      likeHandlerBound = true;
      document.addEventListener('click', function (event) {
        var target = event.target.closest('#likeBtn');
        if (!target) return;
        handleLikeToggle(target, target.dataset.likeSlug);
      });
    }

    try {
      var queue = JSON.parse(localStorage.getItem('blog-like-queue') || '[]');
      if (queue.length) {
        localStorage.setItem('blog-like-queue', '[]');
        queue.forEach(function (job) {
          fetch('https://abacus.jasoncameron.dev/hit/' + job.ns + '/' + encodeURIComponent(job.slug + LIKE_KEY_SUFFIX)).catch(function () {
            /* 补发失败则放弃 */
          });
        });
      }
    } catch (e6) {
      /* 忽略 */
    }
  }

  var likeHandlerBound = false;

  // 计数键版本号:旧键上的历史计数无法清零,换版本即全部归零
  var LIKE_KEY_SUFFIX = '-v2';

  function fetchLikeDiff(slug) {
    function getCounter(ns) {
      return fetch('https://abacus.jasoncameron.dev/get/' + ns + '/' + encodeURIComponent(slug + LIKE_KEY_SUFFIX))
        .then(function (res) {
          // 计数器从未创建过时接口返回 404,按 0 处理
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

  function handleLikeToggle(btn, slug) {
    var likeKey = 'blog-liked-' + slug;
    var countKey = 'blog-like-count-' + slug;
    var queueKey = 'blog-like-queue';
    var liked = false;
    var current = 0;
    try {
      liked = localStorage.getItem(likeKey) === '1';
      current = Number(localStorage.getItem(countKey)) || 0;
    } catch (e) {
      liked = false;
      current = 0;
    }
    liked = !liked;
    try {
      if (liked) localStorage.setItem(likeKey, '1');
      else localStorage.removeItem(likeKey);
    } catch (e2) {
      /* 忽略 */
    }
    var optimistic = Math.max(0, current + (liked ? 1 : -1));
    try {
      localStorage.setItem(countKey, String(optimistic));
    } catch (e3) {
      /* 忽略 */
    }
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-label', liked ? '取消点赞' : '点赞这篇文章');
    var countEl = document.getElementById('likeCount');
    if (countEl) countEl.textContent = String(optimistic);
    var ns = liked ? 'shiguang-likes' : 'shiguang-unlikes';
    fetch('https://abacus.jasoncameron.dev/hit/' + ns + '/' + encodeURIComponent(slug + LIKE_KEY_SUFFIX))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        // 接口只返回单侧计数器的值,必须重新拉两侧求差,否则取消后再点赞会显示成 +2
        fetchLikeDiff(slug).then(function (value) {
          var finalValue = value === null ? optimistic : value;
          if (countEl) countEl.textContent = String(finalValue);
          try {
            localStorage.setItem(countKey, String(finalValue));
          } catch (e4) {
            /* 忽略 */
          }
        });
      })
      .catch(function () {
        try {
          var queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
          queue.push({ ns: ns, slug: slug });
          localStorage.setItem(queueKey, JSON.stringify(queue));
        } catch (e5) {
          /* 忽略 */
        }
      });
  }

  // 评论点赞:每条评论用 comment-<id> 计数键,双计数器求差,每个设备只能点一次
  var CommentLikes = (function () {
    function counterKey(id) {
      return 'comment-' + id;
    }
    function likedKey(id) {
      return 'blog-liked-comment-' + id;
    }
    function cacheKey(id) {
      return 'blog-comment-like-count-' + id;
    }
    function isLiked(id) {
      try {
        return localStorage.getItem(likedKey(id)) === '1';
      } catch (e) {
        return false;
      }
    }
    function cachedCount(id) {
      try {
        return Number(localStorage.getItem(cacheKey(id))) || 0;
      } catch (e) {
        return 0;
      }
    }
    function setCached(id, value) {
      try {
        localStorage.setItem(cacheKey(id), String(value));
      } catch (e) {
        /* 忽略 */
      }
    }
    function fetchDiff(id) {
      function get(ns) {
        return fetch('https://abacus.jasoncameron.dev/get/' + ns + '/' + encodeURIComponent(counterKey(id)))
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
      return Promise.all([get('shiguang-likes'), get('shiguang-unlikes')]).then(function (results) {
        if (results[0] === null || results[1] === null) return null;
        return Math.max(0, results[0] - results[1]);
      });
    }
    function updateUI(id, liked, count) {
      document.querySelectorAll('[data-clike="' + id + '"]').forEach(function (btn) {
        btn.classList.toggle('liked', liked);
        btn.setAttribute('aria-label', liked ? '取消点赞' : '点赞这条评论');
        var num = btn.querySelector('.comment-like-count');
        if (num) num.textContent = String(count);
      });
    }
    function toggle(id) {
      var liked = !isLiked(id);
      try {
        if (liked) localStorage.setItem(likedKey(id), '1');
        else localStorage.removeItem(likedKey(id));
      } catch (e) {
        /* 忽略 */
      }
      var optimistic = Math.max(0, cachedCount(id) + (liked ? 1 : -1));
      setCached(id, optimistic);
      updateUI(id, liked, optimistic);
      var ns = liked ? 'shiguang-likes' : 'shiguang-unlikes';
      fetch('https://abacus.jasoncameron.dev/hit/' + ns + '/' + encodeURIComponent(counterKey(id)))
        .then(function () {
          return fetchDiff(id);
        })
        .then(function (value) {
          if (value === null) return;
          setCached(id, value);
          updateUI(id, isLiked(id), value);
        })
        .catch(function () {
          /* 离线时保留乐观值 */
        });
    }
    var bound = false;
    function bind() {
      if (bound) return;
      bound = true;
      document.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-clike]');
        if (btn) toggle(btn.getAttribute('data-clike'));
      });
    }
    function decorate(container) {
      bind();
      (container || document).querySelectorAll('[data-clike]').forEach(function (btn) {
        var id = btn.getAttribute('data-clike');
        updateUI(id, isLiked(id), cachedCount(id));
        fetchDiff(id).then(function (value) {
          if (value === null) return;
          setCached(id, value);
          updateUI(id, isLiked(id), value);
        });
      });
    }
    function button(id) {
      return '<button class="comment-like-btn" type="button" data-clike="' + id + '" aria-label="点赞这条评论">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.6-4.9-10-9.4C.4 8.5 2.5 4.9 6 4.9c2 0 3.4 1.1 4.2 2.4h3.6c.8-1.3 2.2-2.4 4.2-2.4 3.5 0 5.6 3.6 4 6.7C19.6 16.1 12 21 12 21z"/></svg>' +
        '<span class="comment-like-count">0</span>' +
      '</button>';
    }
    return { decorate: decorate, button: button };
  })();
  window.CommentLikes = CommentLikes;

  // 通用图片灯箱:文章、动态、评论里的图片点击后放大查看,支持左右滑动
  var SiteLightbox = (function () {
    var overlay = null;
    var img = null;
    var closeBtn = null;
    var prevBtn = null;
    var nextBtn = null;
    var items = [];
    var index = 0;

    function build() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'site-lightbox';
      overlay.hidden = true;
      overlay.innerHTML =
        '<button class="site-lightbox-close" type="button" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '<img alt="放大查看">' +
        '<button class="site-lightbox-nav site-lightbox-prev" type="button" aria-label="上一张"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>' +
        '<button class="site-lightbox-nav site-lightbox-next" type="button" aria-label="下一张"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
      document.body.appendChild(overlay);
      img = overlay.querySelector('img');
      closeBtn = overlay.querySelector('.site-lightbox-close');
      prevBtn = overlay.querySelector('.site-lightbox-prev');
      nextBtn = overlay.querySelector('.site-lightbox-next');
      closeBtn.addEventListener('click', close);
      prevBtn.addEventListener('click', function () { show(index - 1); });
      nextBtn.addEventListener('click', function () { show(index + 1); });
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) close();
      });
      document.addEventListener('keydown', function (event) {
        if (!overlay || overlay.hidden) return;
        if (event.key === 'Escape') close();
        if (event.key === 'ArrowLeft') show(index - 1);
        if (event.key === 'ArrowRight') show(index + 1);
      });
      var startX = 0;
      overlay.addEventListener('touchstart', function (event) {
        startX = event.touches[0].clientX;
      }, { passive: true });
      overlay.addEventListener('touchend', function (event) {
        var dx = event.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 50) show(dx < 0 ? index + 1 : index - 1);
      }, { passive: true });
    }

    function show(newIndex) {
      if (!items.length) return;
      index = (newIndex + items.length) % items.length;
      img.src = items[index];
    }

    function open(sources, startIndex) {
      build();
      items = sources;
      show(startIndex || 0);
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function close() {
      if (!overlay) return;
      overlay.hidden = true;
      document.body.style.overflow = '';
    }

    function watch(container) {
      (container || document).querySelectorAll('img:not([data-no-lightbox])').forEach(function (el) {
        if (el.dataset.lightboxBound) return;
        el.dataset.lightboxBound = '1';
        el.style.cursor = 'zoom-in';
        el.addEventListener('click', function () {
          var scope = el.closest('.moment-card') || el.closest('.post-content') || el.closest('.comment-item') || document;
          var imgs = Array.prototype.slice.call(scope.querySelectorAll('img:not([data-no-lightbox])')).map(function (n) { return n.src || n.currentSrc; });
          open(imgs, imgs.indexOf(el.src || el.currentSrc));
        });
      });
    }
    return { open: open, close: close, watch: watch };
  })();
  window.SiteLightbox = SiteLightbox;

  function renderComment(item) {
    return '' +
      '<div class="comment-item">' +
        '<div class="comment-head">' +
          '<img class="comment-avatar" src="' + (item.nick === 'HSH(站长)' ? 'assets/icon.jpg' : 'assets/avatar-default.jpg') + '" alt="" onerror="this.style.display=\'none\'">' +
          '<strong>' + escapeHtml(item.nick) + '</strong><span>' + escapeHtml(item.time || '') + '</span>' +
          (item.device ? '<span class="comment-device">' + escapeHtml(item.device) + '</span>' : '') +
        '</div>' +
        '<p class="comment-content">' + escapeHtml(item.content) + '</p>' +
        (item.reply ? '<div class="comment-reply"><strong>博主回复：</strong>' + escapeHtml(item.reply) + '</div>' : '') +
        '<div class="comment-foot">' +
          (item.email ? '<span class="comment-device">' + escapeHtml(item.device || '') + '</span>' : '') +
          CommentLikes.button(String(item.id)) +
          '<button type="button" class="comment-reply-btn" data-reply-id="' + escapeHtml(item.id) + '" data-reply-nick="' + escapeHtml(item.nick) + '">回复</button>' +
        '</div>' +
      '</div>';
  }

  function renderCommentTree(item, all) {
    var replies = all.filter(function (c) { return c.parentId === item.id; });
    var html = renderComment(item);
    if (replies.length) {
      html += '<div class="comment-replies">' + replies.map(function (reply) {
        return renderCommentTree(reply, all);
      }).join('') + '</div>';
    }
    return html;
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  function initComments() {
    var section = document.getElementById('commentsSection');
    if (!section) return;
    var slug = section.dataset.slug;
    if (!slug) {
      section.hidden = true;
      return;
    }
    var listEl = document.getElementById('commentList');
    var data = (window.SITE_COMMENTS || {})[slug] || [];
    listEl.innerHTML = data.length
      ? data.filter(function (item) { return !item.parentId; }).map(function (item) {
          return renderCommentTree(item, data);
        }).join('')
      : '<p class="empty-state">还没有评论，写下第一条吧。</p>';
    CommentLikes.decorate(listEl);

    var form = document.getElementById('commentForm');
    var replyTarget = null;
    var replyBanner = document.createElement('div');
    replyBanner.className = 'comment-reply-banner';
    replyBanner.hidden = true;
    form.insertBefore(replyBanner, form.firstChild);

    function clearReplyTarget() {
      replyTarget = null;
      replyBanner.hidden = true;
      replyBanner.textContent = '';
    }

    listEl.addEventListener('click', function (event) {
      var btn = event.target.closest('.comment-reply-btn');
      if (!btn) return;
      replyTarget = { id: btn.dataset.replyId, nick: btn.dataset.replyNick };
      replyBanner.innerHTML = '回复 @' + escapeHtml(replyTarget.nick) + ' <button type="button" class="comment-reply-cancel" aria-label="取消回复">×</button>';
      replyBanner.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    replyBanner.addEventListener('click', function (event) {
      if (event.target.closest('.comment-reply-cancel')) clearReplyTarget();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var nick = document.getElementById('commentNick').value.trim();
      var mail = document.getElementById('commentEmail').value.trim();
      var content = document.getElementById('commentContent').value.trim();
      var status = document.getElementById('commentStatus');
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
        slug: slug,
        nick: (localStorage.getItem('blog-auth') && localStorage.getItem('blog-auth') !== '0') ? 'HSH(站长)' : nick,
        email: mail,
        time: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
        content: content,
        device: getDeviceModel()
      };
      if (replyTarget) {
        item.parentId = replyTarget.id;
        item.parentNick = replyTarget.nick;
      }
      var ownerToken = '';
      try {
        ownerToken = localStorage.getItem('blog-gh-token') || '';
      } catch (e2) {
        ownerToken = '';
      }
      if (isAuthed() && ownerToken) {
        setStatus(status, '已登录：正在直接发布…', 'ok');
        githubCommentPut(slug, item).then(function () {
          var data = (window.SITE_COMMENTS || {})[slug] || [];
          var listEl = document.getElementById('commentList');
          if (listEl) listEl.innerHTML = data.filter(function (c) { return !c.parentId; }).map(function (c) {
            return renderCommentTree(c, data);
          }).join('');
          if (listEl) CommentLikes.decorate(listEl);
          setStatus(status, '已发布。', 'ok');
          clearReplyTarget();
        }).catch(function (e3) {
          var msg = String(e3.message || '').indexOf('409') !== -1 ? '保存冲突，请再点一次提交。' : e3.message;
          setStatus(status, '发布失败：' + msg, 'err');
        });
        return;
      }
      if (!window.PendingComments) {
        setStatus(status, '提交通道暂不可用，请稍后再试。', 'err');
        return;
      }
      setStatus(status, '正在提交…');
      window.PendingComments.add(item).then(function () {
        setStatus(status, '已提交，博主审核通过后就会显示。', 'ok');
        clearReplyTarget();
        document.getElementById('commentNick').value = '';
        document.getElementById('commentEmail').value = '';
        document.getElementById('commentContent').value = '';
      }).catch(function () {
        setStatus(status, '提交失败，请稍后再试。', 'err');
      });
    });
  }

  async function githubCommentPut(slug, comment) {
    var ownerToken = localStorage.getItem('blog-gh-token') || '';
    var headers = {
      Authorization: 'Bearer ' + ownerToken,
      Accept: 'application/vnd.github+json'
    };
    var data = window.SITE_COMMENTS || {};
    if (!data[slug]) data[slug] = [];
    data[slug].push(comment);
    var text = '/* 评论数据：在后台“消息”栏目中管理。 */\nwindow.SITE_COMMENTS = ' + JSON.stringify(data, null, 2) + ';\n';
    var content = btoa(unescape(encodeURIComponent(text)));
    var lastError = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var metaRes = await fetch('https://api.github.com/repos/HSHSpaceX/personal-blog/contents/js/comments.js?ref=main', { headers: headers });
        if (!metaRes.ok) throw new Error('GitHub ' + metaRes.status);
        var meta = await metaRes.json();
        var putRes = await fetch('https://api.github.com/repos/HSHSpaceX/personal-blog/contents/js/comments.js', {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify({
            message: '新增评论：' + comment.nick,
            content: content,
            branch: 'main',
            sha: meta.sha
          })
        });
        if (!putRes.ok) throw new Error('GitHub ' + putRes.status);
        window.SITE_COMMENTS = data;
        return;
      } catch (e) {
        lastError = e;
        if (String(e.message).indexOf('409') === -1 && String(e.message).indexOf('422') === -1) throw e;
      }
    }
    throw lastError;
  }

  function updatePendingBadge(count) {
    document.querySelectorAll('.menu-badge').forEach(function (el) {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
  }

  function refreshPendingBadge() {
    if (!isAuthed() || !window.PendingComments) return;
    window.PendingComments.list().then(function (pending) {
      updatePendingBadge(pending.length);
    }).catch(function () {
      /* 忽略 */
    });
  }

  function setupRail() {
    var rail = document.getElementById('featuredRail');
    var prev = document.getElementById('railPrev');
    var next = document.getElementById('railNext');
    if (!rail || !prev || !next) return;

    function scrollRail(direction) {
      rail.scrollBy({
        left: direction * Math.max(rail.clientWidth - 100, 260),
        behavior: 'smooth'
      });
    }

    prev.addEventListener('click', function () {
      scrollRail(-1);
    });
    next.addEventListener('click', function () {
      scrollRail(1);
    });
  }

  // 识别设备型号用于评论显示
  function getDeviceModel() {
    var ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android.*Mobile/.test(ua)) return 'Android 手机';
    if (/Android/.test(ua)) return 'Android 平板';
    if (/Windows/.test(ua)) return 'Windows 电脑';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux';
    return '未知设备';
  }
  window.getDeviceModel = getDeviceModel;

  function init() {
    posts = window.BLOG_POSTS || [];
    applyContent();
    applyAuthUi();
    setupUserMenu();
    refreshPendingBadge();
    updateFavicon();
    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    renderHome();
    renderArchive();
    renderTimeline();
    renderPost();
    initComments();
    setupReadingProgress();
    setupTheme();
    setupMenu();
    setupReveal();
    setupRail();
    buildContribChart();
  }

  // 本站仓库的 GitHub 提交热力图:悬停显示当天提交次数,不跳转
  var ContribChart = (function () {
    function level(count) {
      if (count === 0) return 0;
      if (count <= 2) return 1;
      if (count <= 4) return 2;
      if (count <= 6) return 3;
      return 4;
    }

    function render(wrap, weeks) {
      wrap.innerHTML = weeks.map(function (wk) {
        return '<div class="contrib-week">' + wk.map(function (d) {
          var label = d.date + '：' + d.count + ' 次提交';
          return '<div class="contrib-day" data-level="' + level(d.count) + '" data-tip="' + label + '"></div>';
        }).join('') + '</div>';
      }).join('');
      var tip = null;
      wrap.addEventListener('mouseover', function (event) {
        var cell = event.target.closest('.contrib-day[data-tip]');
        if (!cell) {
          if (tip) { tip.remove(); tip = null; }
          return;
        }
        if (!tip) {
          tip = document.createElement('div');
          tip.className = 'contrib-tip';
          wrap.appendChild(tip);
        }
        tip.textContent = cell.getAttribute('data-tip');
        var rect = cell.getBoundingClientRect();
        var wrapRect = wrap.getBoundingClientRect();
        tip.style.left = (rect.left - wrapRect.left + rect.width / 2 - 40) + 'px';
        tip.style.top = (rect.top - wrapRect.top - 30) + 'px';
      });
      wrap.addEventListener('mouseleave', function () {
        if (tip) { tip.remove(); tip = null; }
      });
    }

    function build(wrap) {
      // 按日期聚合本站仓库的提交
      fetch('https://api.github.com/repos/HSHSpaceX/personal-blog/commits?per_page=100&since=' + new Date(Date.now() - 365 * 86400000).toISOString())
        .then(function (res) { return res.json(); })
        .then(function (commits) {
          if (!Array.isArray(commits) || !commits.length) return;
          var byDate = {};
          commits.forEach(function (c) {
            var d = c.commit.committer.date.slice(0, 10);
            byDate[d] = (byDate[d] || 0) + 1;
          });
          var days = [];
          var today = new Date();
          for (var i = 364; i >= 0; i--) {
            var dt = new Date(today.getTime() - i * 86400000);
            var ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
            days.push({ date: ds, count: byDate[ds] || 0 });
          }
          var weeks = [];
          var wk = [];
          days.forEach(function (d, i) {
            wk.push(d);
            if (wk.length === 7 || i === days.length - 1) {
              weeks.push(wk);
              wk = [];
            }
          });
          render(wrap, weeks);
        })
        .catch(function () {
          wrap.innerHTML = '<p style="padding:8px;color:var(--muted);font-size:13px">暂时无法加载。</p>';
        });
    }

    return { build: build };
  })();

  function buildContribChart() {
    var wrap = document.getElementById('contribCells');
    if (!wrap) return;
    ContribChart.build(wrap);
  }

  if (window.BLOG_POSTS) {
    init();
  } else {
    document.addEventListener('posts-ready', init);
  }
})();
