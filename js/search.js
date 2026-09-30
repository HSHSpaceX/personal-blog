(function () {
  'use strict';
  var core = window.BlogSearchCore;
  var input = document.getElementById('searchInput');
  var tabs = document.getElementById('searchTabs');
  var results = document.getElementById('searchResults');
  var index = [];
  var ready = false;
  var timer = null;
  var types = [
    { id: 'all', label: '全部' }, { id: 'post', label: '文章' },
    { id: 'moment', label: '动态' }, { id: 'comment', label: '评论' }
  ];
  var selectedType = 'all';

  function readLocation() {
    var params = new URLSearchParams(window.location.search);
    input.value = params.get('q') || '';
    var type = params.get('type') || 'all';
    selectedType = types.some(function (item) { return item.id === type; }) ? type : 'all';
  }
  function writeLocation(replace) {
    var next = new URL(window.location.href);
    var query = input.value.trim();
    if (query) next.searchParams.set('q', query);
    else next.searchParams.delete('q');
    if (selectedType !== 'all') next.searchParams.set('type', selectedType);
    else next.searchParams.delete('type');
    window.history[replace ? 'replaceState' : 'pushState']({}, '', next.pathname + next.search + next.hash);
  }
  function resultUrl(hit) {
    if (hit.type === 'post') return window.BlogUrls.postUrl(hit.slug);
    if (hit.type === 'moment') return 'moments.html#moment-' + encodeURIComponent(hit.id);
    if (hit.slug === 'about') return 'about.html#commentsSection';
    if (hit.slug && hit.slug.indexOf('moment-') === 0) return 'moments.html#' + encodeURIComponent(hit.slug);
    return window.BlogUrls.postUrl(hit.slug) + '#commentsSection';
  }
  function render() {
    if (!ready) return;
    var query = input.value.trim();
    var hits = core.search(index, query);
    var counts = { all: hits.length, post: 0, moment: 0, comment: 0 };
    hits.forEach(function (hit) { counts[hit.type] += 1; });
    tabs.innerHTML = types.map(function (type) {
      return '<button type="button" class="filter-chip' + (selectedType === type.id ? ' active' : '') +
        '" data-type="' + type.id + '" aria-pressed="' + (selectedType === type.id) + '">' +
        type.label + ' ' + counts[type.id] + '</button>';
    }).join('');
    if (!query) {
      results.innerHTML = '<p class="empty-state">输入关键词开始搜索。</p>';
      return;
    }
    var shown = selectedType === 'all' ? hits : hits.filter(function (hit) { return hit.type === selectedType; });
    if (!shown.length) {
      results.innerHTML = '<p class="empty-state">没有找到相关内容。</p>';
      return;
    }
    var terms = core.termsFor(query);
    results.innerHTML = shown.map(function (hit) {
      var label = types.find(function (type) { return type.id === hit.type; }).label;
      var title = hit.type === 'post' ? hit.title : hit.title.slice(0, 64) + (hit.title.length > 64 ? '…' : '');
      return '<a class="search-hit" href="' + core.escapeHtml(resultUrl(hit)) + '">' +
        '<div class="search-hit-head"><span class="search-hit-type">' + label +
        '</span><span class="search-hit-date">' + core.escapeHtml(hit.date) + '</span></div>' +
        '<h3>' + core.highlight(title, terms) + '</h3>' +
        (hit.snippet ? '<p>' + core.highlight(hit.snippet, terms) + '</p>' : '') +
        '</a>';
    }).join('');
  }
  function initialize() {
    if (ready) return;
    index = core.createIndex(window.BLOG_POSTS || [], window.BLOG_MOMENTS || [], window.SITE_COMMENTS || {});
    ready = true;
    render();
  }
  readLocation();
  input.addEventListener('input', function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { writeLocation(true); render(); }, 250);
  });
  tabs.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-type]');
    if (!button) return;
    selectedType = button.dataset.type;
    writeLocation(false);
    render();
  });
  window.addEventListener('popstate', function () { readLocation(); render(); });
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
    var target = event.target;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    input.focus();
  });
  document.getElementById('year').textContent = new Date().getFullYear();
  if (window.BLOG_POSTS && window.BLOG_MOMENTS && window.SITE_COMMENTS) initialize();
  else document.addEventListener('posts-ready', initialize, { once: true });
})();
