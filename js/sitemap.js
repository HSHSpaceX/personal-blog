(function () {
  'use strict';
  var BASE = 'https://hshspacex.github.io/personal-blog';
  var posts = window.BLOG_POSTS || [];
  var urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/archive.html', priority: '0.8', changefreq: 'daily' },
    { loc: '/moments.html', priority: '0.8', changefreq: 'daily' },
    { loc: '/gallery.html', priority: '0.7', changefreq: 'weekly' },
    { loc: '/about.html', priority: '0.7', changefreq: 'monthly' },
    { loc: '/timeline.html', priority: '0.6', changefreq: 'weekly' },
    { loc: '/search.html', priority: '0.5', changefreq: 'monthly' }
  ];
  posts.forEach(function (p) {
    urls.push({
      loc: '/post.html?slug=' + encodeURIComponent(p.slug),
      priority: '0.9',
      changefreq: 'weekly',
      lastmod: p.date
    });
  });
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(function (u) {
      return '  <url><loc>' + BASE + u.loc + '</loc>' +
        (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') +
        '<changefreq>' + u.changefreq + '</changefreq>' +
        '<priority>' + u.priority + '</priority></url>\n';
    }).join('') +
    '</urlset>';
  // console.log(xml);
})();
