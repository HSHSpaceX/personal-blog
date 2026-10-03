(function () {
  'use strict';
  var bound = new WeakSet();
  function setup() {
    var toggle = document.getElementById('themeToggle');
    if (!toggle || bound.has(toggle)) return;
    bound.add(toggle);
    var saved;
    try { saved = localStorage.getItem('blog-theme'); } catch (e) { /* use current page state */ }
    document.documentElement.dataset.theme = (saved || document.documentElement.dataset.theme) === 'dark' ? 'dark' : 'light';
    function label() {
      var text = document.documentElement.dataset.theme === 'dark' ? '切换到浅色模式' : '切换深色模式';
      toggle.setAttribute('aria-label', text);
      toggle.setAttribute('title', text);
    }
    label();
    toggle.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('blog-theme', next); } catch (e) { /* still toggle without storage */ }
      label();
      document.dispatchEvent(new CustomEvent('blog-theme-change', { detail: { theme: next } }));
    });
  }
  window.BlogTheme = { setup: setup };
  setup();
})();
