(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var REPO_RAW = 'https://raw.githubusercontent.com/HSHSpaceX/personal-blog/main/';

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // 文章/动态/画廊里出现的所有资源
  function collectResources() {
    var list = [];
    function add(path, name, source, date) {
      if (!path || path.indexOf('http') === 0) return;
      list.push({ path: path, name: name || path.split('/').pop(), source: source, date: date || '' });
    }

    (window.BLOG_POSTS || []).forEach(function (p) {
      if (p.cover) add(p.cover, p.title + ' (封面)', '文章封面', p.date);
      var html = p.content || '';
      var imgRe = /src="(assets\/[^"]+\.(jpg|jpeg|png|gif|webp))"/gi;
      var m;
      while ((m = imgRe.exec(html)) !== null) add(m[1], m[1].split('/').pop(), '文章: ' + p.title, p.date);
      var vidRe = /src="(assets\/[^"]+\.(mp4|mov|webm))"/gi;
      while ((m = vidRe.exec(html)) !== null) add(m[1], m[1].split('/').pop(), '文章视频: ' + p.title, p.date);
    });

    (window.BLOG_MOMENTS || []).forEach(function (mm) {
      if (mm.image) add(mm.image, mm.image.split('/').pop(), '动态', (mm.time || '').slice(0, 10));
      (mm.media || []).forEach(function (med) {
        if (med && med.src) add(med.src, med.src.split('/').pop(), '动态', (mm.time || '').slice(0, 10));
      });
    });

    (window.BLOG_ALBUMS || []).forEach(function (album) {
      (album.photos || []).forEach(function (ph) {
        if (ph && ph.src) add(ph.src, ph.src.split('/').pop(), '画廊: ' + album.title, album.created || '');
      });
    });

    var seen = {};
    return list.filter(function (r) {
      if (seen[r.path]) return false;
      seen[r.path] = true;
      return true;
    });
  }

  function render() {
    var grid = $('resourceGrid');
    if (!grid) return;
    var list = collectResources();
    if (!list.length) {
      grid.innerHTML = '<p class="empty-state">还没有上传过任何资源。在文章、动态和画廊中上传的文件会显示在这里。</p>';
      return;
    }
    grid.innerHTML = list.map(function (r) {
      var isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(r.path);
      var isVideo = /\.(mp4|mov|webm)$/i.test(r.path);
      var thumb;
      if (isImage) {
        thumb = '<img src="' + escapeHtml(r.path) + '" alt="' + escapeHtml(r.name) + '" loading="lazy">';
      } else if (isVideo) {
        thumb = '<video src="' + escapeHtml(r.path) + '" muted playsinline preload="metadata"></video>';
      } else {
        thumb = '<div class="resource-icon-big">📄</div>';
      }
      return '<div class="resource-card glass-card">' +
        '<div class="resource-thumb">' + thumb + '</div>' +
        '<div class="resource-info">' +
          '<strong title="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</strong>' +
          '<span>' + escapeHtml(r.source) + '</span>' +
          '<span class="resource-path">' + escapeHtml(r.path) + '</span>' +
        '</div>' +
        '<div class="resource-actions">' +
          '<button class="btn" type="button" data-copy="' + escapeHtml(r.path) + '">复制链接</button>' +
          '<a class="btn" href="' + escapeHtml(r.path) + '" target="_blank" rel="noopener">打开</a>' +
          '<a class="btn primary" href="' + escapeHtml(r.path) + '" download="' + escapeHtml(r.name) + '">下载</a>' +
        '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var full = REPO_RAW + btn.getAttribute('data-copy');
        navigator.clipboard.writeText(full).then(function () {
          btn.textContent = '已复制';
          setTimeout(function () { btn.textContent = '复制链接'; }, 1500);
        }).catch(function () {
          window.prompt('复制链接:', full);
        });
      });
    });
  }

  var pendingFiles = [];

  function handleFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      if (file.size > 90 * 1024 * 1024) {
        alert(file.name + ' 超过 90MB 限制');
        return;
      }
      pendingFiles.push(file);
      var item = document.createElement('div');
      item.className = 'resource-upload-item';
      item.innerHTML = '<span>' + escapeHtml(file.name) + '</span><span>' + formatSize(file.size) + '</span>';
      $('resourceUploadList').appendChild(item);
    });
    $('resourceDoUpload').disabled = pendingFiles.length === 0;
  }

  function setupDrop() {
    var drop = $('resourceDrop');
    drop.addEventListener('click', function () { $('resourceFileInput').click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });
    $('resourceFileInput').addEventListener('change', function (e) {
      handleFiles(e.target.files);
    });
    $('resourceDoUpload').addEventListener('click', function () {
      if (!pendingFiles.length) return;
      $('resourceDoUpload').disabled = true;
      $('resourceUploadStatus').textContent = '上传功能需要配置 GitHub Token 或 R2 存储。';
      render();
    });
  }

  function init() {
    $('resourceUploadBtn').addEventListener('click', function () {
      $('resourceUploadModal').hidden = false;
    });
    $('resourceUploadCancel').addEventListener('click', function () {
      pendingFiles = [];
      $('resourceUploadList').innerHTML = '';
      $('resourceUploadStatus').textContent = '';
      $('resourceDoUpload').disabled = true;
      $('resourceUploadModal').hidden = true;
    });
    setupDrop();
    render();
    var timer = setInterval(function () {
      if (window.BLOG_POSTS && window.BLOG_MOMENTS) { render(); clearInterval(timer); }
    }, 300);
  }

  document.getElementById('year').textContent = new Date().getFullYear();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
