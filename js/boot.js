(function () {
  var script = document.createElement('script');
  script.src = 'js/posts.js?v=' + Date.now();
  script.onload = function () {
    document.dispatchEvent(new CustomEvent('posts-ready'));
  };
  script.onerror = function () {
    document.dispatchEvent(new CustomEvent('posts-ready'));
  };
  document.head.appendChild(script);
})();
