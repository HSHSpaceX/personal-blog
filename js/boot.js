(function () {
  var stamp = '?v=' + Date.now();
  var remaining = 6;
  function done() {
    remaining -= 1;
    if (remaining === 0) {
      document.dispatchEvent(new CustomEvent('posts-ready'));
    }
  }
  ['posts.js', 'content.js', 'comments.js', 'pending.js', 'albums.js', 'moments.js'].forEach(function (file) {
    var script = document.createElement('script');
    script.src = 'js/' + file + stamp;
    script.onload = done;
    script.onerror = done;
    document.head.appendChild(script);
  });
})();
