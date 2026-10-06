(function () {
  'use strict';

  var posts = window.BLOG_POSTS || [];
  var postUrl = window.BlogUrls.postUrl;
  var SITE_NAME = '拾光手记';
  function isAuthed() { return window.BlogAuth && window.BlogAuth.isAdmin(); }
  function applyAuthUi() {
    var auth = window.BlogAuth;
    var logged = !!auth.user();
    document.querySelectorAll('.btn-login').forEach(function (el) { el.hidden = logged; });
    document.querySelectorAll('.user-menu-wrap').forEach(function (el) { el.hidden = !logged; });
    document.querySelectorAll('[data-admin-links]').forEach(function (slot) {
      slot.replaceChildren();
      if (!logged || !auth.isAdmin()) return;
      [['account.html#review-center', '审核中心'], ['admin.html#messages', '评论审核'], ['admin.html', '管理后台']].forEach(function (entry) {
        var link = document.createElement('a');
        link.className = 'user-menu-item'; link.href = entry[0]; link.rel = 'nofollow';
        link.textContent = entry[1];
        if (entry[0] === 'admin.html#messages') {
          var badge = document.createElement('span'); badge.className = 'menu-badge'; badge.hidden = true;
          link.appendChild(badge);
        }
        slot.appendChild(link);
      });
    });
    if (!logged) closeUserMenus();
    if (logged) window.BlogData.getProfile(auth.user().id).then(function (profile) {
      if (profile && profile.avatar_url) document.querySelectorAll('.user-avatar img').forEach(function (img) { img.src = profile.avatar_url; });
    }).catch(function () {});
  }
  function closeUserMenus() {
    document.querySelectorAll('.user-menu').forEach(function (el) { el.hidden = true; });
    document.querySelectorAll('.user-avatar').forEach(function (el) { el.setAttribute('aria-expanded', 'false'); });
  }
  function setupUserMenu() {
    document.querySelectorAll('.user-avatar').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        var menu = btn.parentElement.querySelector('.user-menu');
        if (!menu) return;
        var open = menu.hidden;
        closeUserMenus(); menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      });
    });
    document.querySelectorAll('[data-logout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.GitHubCredentials.clear();
        window.BlogAuth.signOut().then(applyAuthUi);
      });
    });
    document.addEventListener('click', function (event) { if (!event.target.closest('.user-menu-wrap')) closeUserMenus(); });
    document.addEventListener('blog-auth-change', function () { applyAuthUi(); refreshPendingBadge(); refreshNotificationBadge(); });
    document.addEventListener('blog-messages-change', refreshNotificationBadge);
  }

  function updateFavicon() {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    link.type = 'image/png';
    link.href = document.documentElement.dataset.theme === 'dark'
      ? 'assets/icon-dark.png'
      : 'assets/icon-light.png';
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

  function postAuthor(post) {
    var p=post.author_profile||{username:'hshspacex',display_name:'HSH(站长)',avatar_url:'assets/icon.jpg'};
    if(window.PublicCards)return window.PublicCards.author(p).outerHTML;
    var username=/^[a-zA-Z0-9_]{3,30}$/.test(p.username||'')?p.username:'';
    return '<a class="public-author" href="profile.html?username='+encodeURIComponent(username)+'"><img class="public-author-avatar" src="'+escapeHtml(/^https:\/\//.test(p.avatar_url||'')?p.avatar_url:(post.author_profile?'assets/avatar-default.jpg':'assets/icon.jpg'))+'" alt="'+escapeHtml(post.author_profile?(p.display_name||username||'用户')+'的头像':'HSH站长头像')+'"><span>'+escapeHtml(p.display_name||username||'作者')+' / @'+escapeHtml(username)+'</span></a>';
  }

  function renderPostCard(post) {
    return '' +
      '<article class="post-card glass-card">' +
        '<a class="post-card-media" href="' + postUrl(post.slug) + '" aria-label="' + escapeHtml(post.title) + '">' +
          '<img src="' + escapeHtml(post.cover) + '" alt="' + escapeHtml(post.title) + '" loading="eager" decoding="async" fetchpriority="high">' +
        '</a>' +
        '<div class="post-card-body">' +
          categoryChip(post) +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          (post.excerpt ? '<p class="post-card-excerpt">' + escapeHtml(post.excerpt) + '</p>' : '') +
          '<div class="post-card-meta">' +
            postAuthor(post) +
            '<span class="post-date">' + formatDate(post.date) + '</span>' +
            '<span>' + post.readingTime + ' 分钟</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderRailCard(post, index) {
    return '' +
      '<article class="rail-card reveal glass-card" style="transition-delay:' + ((index % 4) * 70) + 'ms">' +
        '<a class="rail-card-media" href="' + postUrl(post.slug) + '" aria-label="' + escapeHtml(post.title) + '">' +
          '<img src="' + escapeHtml(post.cover) + '" alt="' + escapeHtml(post.title) + '" loading="eager" decoding="async" fetchpriority="high">' +
        '</a>' +
        '<div class="rail-card-body">' +
          categoryChip(post) +
          '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
          (post.excerpt ? '<p class="rail-card-excerpt">' + escapeHtml(post.excerpt) + '</p>' : '') +
          '<div class="rail-card-meta">' +
            postAuthor(post) +
            '<span>' + formatDate(post.date) + '</span>' +
            '<span>' + post.readingTime + ' 分钟</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderArchiveRow(post) {
    return '<article class="archive-row glass-card">' +
      '<a class="archive-thumb" href="' + postUrl(post.slug) + '" aria-label="' + escapeHtml(post.title) + '">' +
        '<img src="' + escapeHtml(post.cover) + '" alt="' + escapeHtml(post.title) + '" loading="lazy" decoding="async"></a>' +
      '<div class="archive-row-main">' + categoryChip(post) +
        '<h3><a href="' + postUrl(post.slug) + '">' + escapeHtml(post.title) + '</a></h3>' +
        (post.excerpt ? '<p>' + escapeHtml(post.excerpt) + '</p>' : '') + postAuthor(post) + '</div>' +
      '<div class="archive-row-side"><div class="archive-row-tags">' + (post.tags || []).map(function (tag) {
        return '<a class="archive-tag-link" href="' + tagUrl(tag) + '">' + escapeHtml(tag) + '</a>';
      }).join('') + '</div><time datetime="' + escapeHtml(post.date) + '">' + formatDate(post.date) + '</time>' +
      '<span>' + escapeHtml(post.readingTime) + ' 分钟阅读</span></div></article>';
  }

  function renderHome() {
    var gridEl = document.getElementById('postGrid');
    var statsEl = document.getElementById('introStats');
    var categoryEl = document.getElementById('categoryList');

    var sorted = posts.slice().sort(function (a, b) {
      return b.date.localeCompare(a.date);
    });

    var railEl = document.getElementById('featuredRail');
    if (railEl) {
      var featured = sorted.filter(function (post) { return post.featured === true; });
      railEl.innerHTML = featured.map(renderRailCard).join('');
      var section = document.getElementById('featuredSection');
      if (section) section.hidden = featured.length === 0;
      var nav = railEl.parentElement.querySelector('.rail-nav');
      if (nav) nav.hidden = featured.length < 2;
      ['railPrev', 'railNext'].forEach(function (id) {
        var button = document.getElementById(id);
        if (button) button.disabled = featured.length < 2;
      });
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
      var latestDate = posts.length ? posts[0].date : '';
      posts.forEach(function (post) {
        if (categories.indexOf(post.category) === -1) categories.push(post.category);
        if (post.date > latestDate) latestDate = post.date;
      });
      statsEl.innerHTML =
        '<span class="stat"><strong>' + posts.length + '</strong> 篇文章</span>' +
        '<span class="stat"><strong>' + categories.length + '</strong> 个分类</span>' +
        (latestDate ? '<span class="stat">更新于 ' + formatDate(latestDate) + '</span>' : '');
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

    renderHomeComments(window.SITE_COMMENTS ? latestStaticComments() : []);
    refreshHomeComments();
  }

  function latestStaticComments() {
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
    return allComments.slice(0, 9);
  }

  function renderHomeComments(latestComments) {
    var homeCommentsEl = document.getElementById('homeComments');
    if (!homeCommentsEl) return;
    var commentsBand = homeCommentsEl.closest('.band');
    if (!latestComments.length) {
      if (commentsBand) commentsBand.hidden = true;
      return;
    }
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

  async function refreshHomeComments() {
    try {
      var rows = await window.BlogData.listLatestComments(9);
      renderHomeComments(rows);
    } catch (error) { /* keep static comments as fallback */ }
  }

  if (typeof window.setInterval === 'function') {
    window.setInterval(refreshHomeComments, 20000);
  }

  function renderArchive() {
    var listEl = document.getElementById('archiveList');
    var catWrap = document.getElementById('archiveCategories');
    var statsEl = document.getElementById('archiveStats');
    var allTagsEl = document.getElementById('archiveAllTags');
    if (!listEl || !catWrap) return;

    var params = new URLSearchParams(window.location.search);
    var activeCategory = params.get('category') || '';
    var activeTag = params.get('tag') || '';
    var categoryNames = Array.from(new Set(posts.map(function (post) { return post.category; })));
    var configured = window.BLOG_CATEGORY_GROUPS || [];
    var knownNames = new Set(configured.flatMap(function (group) { return group.cats.map(function (cat) { return cat.name; }); }));
    var unknown = categoryNames.filter(function (name) { return !knownNames.has(name); }).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    var groups = configured.slice();
    if (unknown.length) groups.push({ title: '其他', cats: unknown.map(function (name) { return { name: name }; }) });
    var counts = {};
    var commentCounts = {};
    var comments = window.SITE_COMMENTS || {};
    posts.forEach(function (post) {
      counts[post.category] = (counts[post.category] || 0) + 1;
      commentCounts[post.category] = (commentCounts[post.category] || 0) + (comments[post.slug] || []).length;
    });
    var tags = Array.from(new Set(posts.flatMap(function (post) { return post.tags || []; }))).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    var latestDate = posts.map(function (post) { return post.date; }).sort().pop();
    if (statsEl) statsEl.innerHTML = '<strong>' + posts.length + '</strong> 篇文章 · <strong>' + categoryNames.length + '</strong> 个分类' +
      (latestDate ? ' · 最近更新 ' + formatDate(latestDate) : '');

    if (allTagsEl) {
      allTagsEl.innerHTML = tags.length ? '<h2>全部标签</h2><div class="archive-tag-filter">' + tags.map(function (tag) {
        return '<a class="filter-chip" href="' + tagUrl(tag) + '">' + escapeHtml(tag) + '</a>';
      }).join('') + '</div>' : '';
      allTagsEl.style.display = activeCategory || activeTag ? 'none' : '';
    }
    catWrap.innerHTML = groups.map(function (group) {
      return '<div class="archive-group"><h2 class="archive-group-title">' + escapeHtml(group.title) + '</h2>' +
        group.cats.map(function (cat) {
          var count = counts[cat.name] || 0;
          var commentCount = commentCounts[cat.name] || 0;
          return '<a class="archive-cat-row" href="' + categoryUrl(cat.name) + '">' +
            (cat.icon ? '<div class="archive-cat-icon"><img src="' + escapeHtml(cat.icon) + '" alt=""></div>' : '') +
            '<div class="archive-cat-info"><div class="archive-cat-head"><strong>' + escapeHtml(cat.name) + '</strong><span class="archive-cat-count">(' + count + ')</span>' +
            (commentCount ? '<span class="archive-cat-new">' + commentCount + ' 条评论</span>' : '') + '</div>' +
            (count ? '<p class="cat-card-count">' + count + ' 篇文章</p>' : '<p class="archive-empty">暂无文章</p>') +
            '</div></a>';
        }).join('') + '</div>';
    }).join('');

    var listSection = listEl.closest('.archive-list');
    if (!activeCategory && !activeTag) {
      listEl.innerHTML = '';
      if (listSection) listSection.style.display = 'none';
      return;
    }
    catWrap.style.display = 'none';
    if (statsEl) statsEl.style.display = 'none';
    if (listSection) listSection.style.display = '';

    var group = groups.find(function (item) { return item.title === activeCategory; });
    var groupCats = group ? group.cats.map(function (cat) { return cat.name; }) : [activeCategory];
    var categoryPosts = activeCategory ? posts.filter(function (post) { return groupCats.includes(post.category); }) : posts;
    var availableTags = Array.from(new Set(categoryPosts.flatMap(function (post) { return post.tags || []; }))).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    var showFeatured = params.get('featured') === '1';
    var filtered = categoryPosts.filter(function (post) {
      if (activeTag && !(post.tags || []).includes(activeTag)) return false;
      if (showFeatured && !post.featured) return false;
      return true;
    });
    var icon = group && group.cats[0] ? group.cats[0].icon : '';
    if (!group && activeCategory) {
      groups.forEach(function (item) { item.cats.forEach(function (cat) { if (cat.name === activeCategory) icon = cat.icon; }); });
    }
    var title = activeCategory || '标签：' + activeTag;
    function filterUrl(tag) {
      var query = new URLSearchParams();
      if (activeCategory) query.set('category', activeCategory);
      if (tag) query.set('tag', tag);
      return 'archive.html' + (query.toString() ? '?' + query.toString() : '');
    }
    function featuredUrl() {
      var query = new URLSearchParams();
      if (activeCategory) query.set('category', activeCategory);
      if (!showFeatured) query.set('featured', '1');
      return 'archive.html' + (query.toString() ? '?' + query.toString() : '');
    }
    listEl.innerHTML = '<div class="cat-page-header"><div class="cat-page-title-row">' +
      (icon ? '<div class="cat-page-icon"><img src="' + escapeHtml(icon) + '" alt=""></div>' : '') +
      '<div><h2 class="cat-page-title">' + escapeHtml(title) + '</h2><p class="archive-result-count">' + filtered.length + ' 篇文章</p></div></div>' +
      '<a class="btn cat-page-back" href="archive.html">← 返回归档</a></div>' +
      '<div class="archive-tag-filter" aria-label="筛选">' +
        '<a class="filter-chip' + (showFeatured ? ' active' : '') + '" href="' + featuredUrl() + '">精选文章</a>' +
        (availableTags.length ?
        [''].concat(availableTags).map(function (tag) {
          return '<a class="filter-chip' + (activeTag === tag ? ' active' : '') + '" href="' + filterUrl(tag) + '">' + escapeHtml(tag || '全部') + '</a>';
        }).join('') : '') +
      '</div>' +
      '<div class="archive-list-inner">' +
      (filtered.length ? filtered.map(renderArchiveRow).join('') : '<p class="empty-state">没有找到匹配的文章。</p>') + '</div>';
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
    // Cloudflare Pages redirects .html URLs to extensionless routes.
    var staticMatch = window.location.pathname.match(/\/posts\/([a-z0-9-]+)(?:\.html)?\/?$/);
    var slug = staticMatch ? staticMatch[1] : params.get('slug');
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
    window.BlogTheme.setup();
    document.addEventListener('blog-theme-change', updateFavicon);
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
      html += '<a class="toc-link toc-' + head.tagName.toLowerCase() + '" href="' + window.location.pathname + window.location.search + '#' + id + '">' + escapeHtml(head.textContent) + '</a>';
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

  function loginForAction() {
    if (window.BlogAuth.user()) return true;
    location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
    return false;
  }
  function initLikes(slug) {
    var btn = document.getElementById('likeBtn');
    var count = document.getElementById('likeCount');
    if (!btn || !count) return;
    async function refresh() {
      try {
        var row = (await window.BlogData.likes('post', [slug]))[slug] || { count: 0, liked: false };
        count.textContent = String(row.count);
        btn.classList.toggle('liked', row.liked);
        btn.setAttribute('aria-label', row.liked ? '取消点赞' : '点赞这篇文章');
      } catch (error) { count.textContent = '—'; }
    }
    btn.onclick = async function () {
      if (!loginForAction()) return;
      btn.disabled = true;
      try { await window.BlogData.toggleLike('post', slug); await refresh(); }
      catch (error) { alert(error.message); }
      finally { btn.disabled = false; }
    };
    refresh();
    document.addEventListener('blog-auth-change', refresh);
  }
  var CommentLikes = (function () {
    var bound = false;
    function button(id) {
      return '<button class="comment-like-btn" type="button" data-clike="' + escapeHtml(id) + '" aria-label="点赞这条评论">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.6-4.9-10-9.4C.4 8.5 2.5 4.9 6 4.9c2 0 3.4 1.1 4.2 2.4h3.6c.8-1.3 2.2-2.4 4.2-2.4 3.5 0 5.6 3.6 4 6.7C19.6 16.1 12 21 12 21z"/></svg>' +
        '<span class="comment-like-count">0</span></button>';
    }
    async function decorate(container) {
      if (!bound) {
        bound = true;
        document.addEventListener('click', async function (event) {
          var btn = event.target.closest('[data-clike]');
          if (!btn) return;
          if (!loginForAction()) return;
          btn.disabled = true;
          try { await window.BlogData.toggleLike('comment', btn.dataset.clike); await decorate(document); }
          catch (error) { alert(error.message); }
          finally { btn.disabled = false; }
        });
      }
      var buttons = Array.from((container || document).querySelectorAll('[data-clike]'));
      var ids = buttons.map(function (btn) { return btn.dataset.clike; });
      try {
        var rows = await window.BlogData.likes('comment', ids);
        buttons.forEach(function (btn) {
          var row = rows[btn.dataset.clike] || { count: 0, liked: false };
          btn.classList.toggle('liked', row.liked);
          btn.querySelector('.comment-like-count').textContent = String(row.count);
        });
      } catch (error) { /* read-only fallback */ }
    }
    return { button: button, decorate: decorate };
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
          '<img class="comment-avatar" src="' + escapeHtml(item.avatar && /^https:\/\//.test(item.avatar) ? item.avatar : (item.nick === 'HSH(站长)' ? 'assets/icon.jpg' : 'assets/avatar-default.jpg')) + '" alt="">' +
          (item.username
            ? '<a class="comment-author" href="profile.html?username=' + encodeURIComponent(item.username) + '">' + escapeHtml(item.nick) + '</a>'
            : '<strong>' + escapeHtml(item.nick) + '</strong>') + '<span>' + escapeHtml(item.time || '') + '</span>' +
          (item.status === 'pending' ? '<span>待审核</span>' : '') +
        '</div>' +
        '<p class="comment-content">' + escapeHtml(item.content) + '</p>' +
        '<div class="comment-foot">' +
          (item.status === 'approved' && !item.legacy ? CommentLikes.button(String(item.id)) : '') +
          (item.own&&!item.legacy?'<a class="btn" rel="nofollow" href="account.html?comment='+encodeURIComponent(item.id)+'#my-comments">编辑我的评论</a>':'') +
          '<button type="button" class="comment-reply-btn" data-reply-id="' + escapeHtml(item.id) + '" data-reply-nick="' + escapeHtml(item.nick) + '">回复</button>' +
        '</div>' +
      '</div>';
  }

  function renderCommentTree(item, all) {
    var replies = all.filter(function (c) { return c.parentId === item.id; });
    var html = renderComment(item);
    if (replies.length) {
      var repliesHtml = replies.map(function (reply) {
        return renderCommentTree(reply, all);
      }).join('');
      html += '<button type="button" class="comment-collapse-toggle" data-collapsed="true">展开 ' + replies.length + ' 条回复</button>' +
        '<div class="comment-replies" hidden>' + repliesHtml + '</div>';
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
    if (!slug) { section.hidden = true; return; }
    var listEl = document.getElementById('commentList');
    var form = document.getElementById('commentForm');
    var replyTarget = null;
    var replyBanner = document.createElement('div');
    replyBanner.className = 'comment-reply-banner'; replyBanner.hidden = true;
    form.insertBefore(replyBanner, form.firstChild);
    function clearReply() { replyTarget = null; replyBanner.hidden = true; replyBanner.textContent = ''; }
    var commentGeneration=0;
    async function refresh() {
      var attempt=++commentGeneration;listEl.replaceChildren();
      try {
        var all = await window.BlogData.listComments(slug);if(attempt!==commentGeneration)return;
        listEl.innerHTML = all.length ? all.filter(function (item) { return !item.parentId; }).map(function (item) {
          return renderCommentTree(item, all);
        }).join('') : '<p class="empty-state">还没有评论，写下第一条吧。</p>';
        CommentLikes.decorate(listEl);
      } catch (error) { if(attempt===commentGeneration)listEl.textContent = '评论加载失败：' + error.message; }
    }
    listEl.addEventListener('click', function (event) {
      var toggle = event.target.closest('.comment-collapse-toggle');
      if (toggle) {
        var replies = toggle.nextElementSibling;
        replies.hidden = !replies.hidden;
        toggle.textContent = replies.hidden ? '展开回复' : '收起回复';
        return;
      }
      var btn = event.target.closest('.comment-reply-btn');
      if (!btn) return;
      replyTarget = { id: btn.dataset.replyId, nick: btn.dataset.replyNick };
      replyBanner.innerHTML = '回复 @' + escapeHtml(replyTarget.nick) + ' <button type="button" class="comment-reply-cancel" aria-label="取消回复">×</button>';
      replyBanner.hidden = false; form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    replyBanner.addEventListener('click', function (event) { if (event.target.closest('.comment-reply-cancel')) clearReply(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var status = document.getElementById('commentStatus');
      var content = document.getElementById('commentContent').value.trim();
      if (!content) { setStatus(status, '请输入评论内容。', 'err'); return; }
      if (!loginForAction()) return;
      try {
        setStatus(status, '正在提交…');
        await window.BlogData.addComment(slug, content, replyTarget && replyTarget.id);
        document.getElementById('commentContent').value = '';
        clearReply(); await refresh();
        setStatus(status, '评论已提交，审核通过后公开可见。', 'ok');
      } catch (error) { setStatus(status, '提交失败：' + error.message, 'err'); }
    });
    refresh();
    document.addEventListener('blog-auth-change', refresh);
  }

  function updatePendingBadge(count) {
    document.querySelectorAll('.menu-badge:not(.notification-badge)').forEach(function (el) {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
  }

  function refreshPendingBadge() {
    if (!isAuthed()) { updatePendingBadge(0); return; }
    window.BlogData.listModeration().then(function (rows) {
      updatePendingBadge(rows.filter(function (row) { return row.status === 'pending'; }).length);
    }).catch(function () { updatePendingBadge(0); });
  }

  function updateNotificationBadge(count) {
    document.querySelectorAll('.notification-badge').forEach(function (el) {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
  }

  var notificationBadgeGeneration = 0;
  function refreshNotificationBadge() {
    var token = ++notificationBadgeGeneration, actor = window.BlogAuth.user();
    updateNotificationBadge(0);
    if (!window.BlogAuth.user()) { updateNotificationBadge(0); return; }
    window.BlogData.messageUnreadCount().then(function (count) {
      if (token === notificationBadgeGeneration && window.BlogAuth.user() && window.BlogAuth.user().id === actor.id) updateNotificationBadge(count);
    }).catch(function () { if (token === notificationBadgeGeneration) updateNotificationBadge(0); });
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

  function init() {
    posts = window.BLOG_POSTS || [];
    applyContent();
    applyAuthUi();
    setupUserMenu();
    refreshPendingBadge();
    refreshNotificationBadge();
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
        var tipX = rect.left - wrapRect.left + rect.width / 2;
        var tipY = rect.top - wrapRect.top - 30;
        // 防止溢出右边界
        tip.style.left = Math.max(4, Math.min(tipX - 60, wrapRect.width - 70)) + 'px';
        tip.style.top = Math.max(0, tipY) + 'px';
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
