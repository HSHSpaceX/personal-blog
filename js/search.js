(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function formatDate(iso) {
    try {
      var date = new Date(iso + 'T00:00:00');
      return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
    } catch (e) {
      return iso;
    }
  }

  function stripHtml(html) {
    var div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
  }

  var input = document.getElementById('searchInput');
  var results = document.getElementById('searchResults');
  var posts = window.BLOG_POSTS || [];
  var moments = window.BLOG_MOMENTS || [];
  var comments = window.SITE_COMMENTS || {};

  function search(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '<p class="empty-state">输入关键词开始搜索。</p>';
      return;
    }

    var hits = [];

    posts.forEach(function (post) {
      var text = (post.title + ' ' + post.excerpt + ' ' + post.category + ' ' + (post.tags || []).join(' ')).toLowerCase();
      if (text.indexOf(q) !== -1) {
        hits.push({
          type: '文章',
          title: post.title,
          excerpt: post.excerpt || stripHtml(post.content).slice(0, 100),
          url: 'post.html?slug=' + encodeURIComponent(post.slug),
          date: post.date
        });
      }
    });

    moments.forEach(function (m) {
      if ((m.text || '').toLowerCase().indexOf(q) !== -1) {
        hits.push({
          type: '动态',
          title: m.text.slice(0, 60) + (m.text.length > 60 ? '…' : ''),
          excerpt: '',
          url: 'moments.html#moment-' + m.id,
          date: m.time || ''
        });
      }
    });

    Object.keys(comments).forEach(function (slug) {
      (comments[slug] || []).forEach(function (c) {
        if ((c.content || '').toLowerCase().indexOf(q) !== -1) {
          hits.push({
            type: '评论',
            title: c.nick + '：' + c.content.slice(0, 60),
            excerpt: '',
            url: slug === 'about' ? 'about.html#commentsSection' : 'post.html?slug=' + encodeURIComponent(slug) + '#commentsSection',
            date: c.time || ''
          });
        }
      });
    });

    if (!hits.length) {
      results.innerHTML = '<p class="empty-state">没有找到相关内容。</p>';
      return;
    }

    hits.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    results.innerHTML = hits.map(function (hit) {
      return '<a class="search-hit" href="' + escapeHtml(hit.url) + '">' +
        '<div class="search-hit-head"><span class="search-hit-type">' + escapeHtml(hit.type) + '</span><span class="search-hit-date">' + escapeHtml(hit.date) + '</span></div>' +
        '<h3>' + escapeHtml(hit.title) + '</h3>' +
        (hit.excerpt ? '<p>' + escapeHtml(hit.excerpt) + '</p>' : '') +
      '</a>';
    }).join('');
  }

  var timer = null;
  input.addEventListener('input', function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { search(input.value); }, 250);
  });

  // 支持 ?q=xxx 直接搜索
  var params = new URLSearchParams(window.location.search);
  var initial = params.get('q');
  if (initial) {
    input.value = initial;
    search(initial);
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
