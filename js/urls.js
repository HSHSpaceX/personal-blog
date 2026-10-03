(function (root) {
  'use strict';
  function postUrl(slug) {
    return 'posts/' + encodeURIComponent(slug) + '.html';
  }
  var api = { postUrl: postUrl };
  root.BlogUrls = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
