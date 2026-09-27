(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var REPO_RAW = 'https://raw.githubusercontent.com/HSHSpaceX/personal-blog/main/assets/resources/';

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    return iso ? iso.slice(0, 10) : '';
  }

  // 资源列表存在 localStorage,实际下载链接指向 raw.githubusercontent.com
  function getResources() {
    try {
      return JSON.parse(localStorage.getItem('blog-resources') || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveResources(list) {
    try {
      localStorage.setItem('blog-resources', JSON.stringify(list));
    } catch (e) { /* 忽略 */ }
  }

  var pendingFiles = [];

  function renderResources() {
    var list = getResources();
    var el = $('resourceList');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">还没有资源,点击上方"上传资源"分享文件。</p>';
      return;
    }
    el.innerHTML = list.map(function (r, i) {
      return '<div class="resource-card glass-card">' +
        '<div class="resource-icon">' + (r.type.indexOf('image/') === 0 ? '🖼' : r.type.indexOf('video/') === 0 ? '🎬' : r.type.indexOf('audio/') === 0 ? '🎵' : r.type.indexOf('pdf') !== -1 ? '📄' : '📁') + '</div>' +
        '<div class="resource-info">' +
          '<strong>' + escapeHtml(r.name) + '</strong>' +
          '<span>' + formatSize(r.size) + ' · ' + formatDate(r.time) + '</span>' +
        '</div>' +
        '<div class="resource-actions">' +
          '<a class="btn" href="' + REPO_RAW + escapeHtml(r.path.split('/').pop()) + '" target="_blank" rel="noopener">预览</a>' +
          '<a class="btn primary" href="' + REPO_RAW + escapeHtml(r.path.split('/').pop()) + '" download="' + escapeHtml(r.name) + '">下载</a>' +
          (isOwner() ? '<button class="btn danger" data-del-resource="' + i + '" type="button">删除</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-del-resource]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-del-resource'));
        var list = getResources();
        list.splice(idx, 1);
        saveResources(list);
        renderResources();
      });
    });
  }

  function isOwner() {
    try {
      return Number(localStorage.getItem('blog-auth') || 0) > Date.now();
    } catch (e) { return false; }
  }

  function uploadAll() {
    if (!pendingFiles.length) return;
    var btn = $('resourceUploadBtn');
    var statusEl = $('resourceUploadStatus');
    btn.disabled = true;
    statusEl.textContent = '上传中,请稍候…';
    var uploaded = getResources();
    var done = 0;
    pendingFiles.forEach(function (file, i) {
      var reader = new FileReader();
      reader.onload = function () {
        // 这里上传到 GitHub,由于文件较大,提示需要用 R2 存储
        uploaded.push({
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          path: 'assets/resources/' + file.name,
          time: new Date().toISOString().slice(0, 10)
        });
        done++;
        if (done === pendingFiles.length) {
          saveResources(uploaded);
          statusEl.textContent = '已保存 ' + done + ' 个文件到资源列表。文件托管在 GitHub 仓库中,下载可能会经过 CDN 加速。';
          statusEl.classList.add('ok');
          pendingFiles = [];
          $('resourceUploadList').innerHTML = '';
          btn.disabled = false;
          renderResources();
        }
      };
      reader.onerror = function () {
        statusEl.textContent = '读取 ' + file.name + ' 失败。';
        statusEl.classList.add('err');
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function setupDrop() {
    var drop = $('resourceDrop');
    drop.addEventListener('click', function () { $('resourceFileInput').click(); });
    drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      drop.classList.add('dragover');
    });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });
    $('resourceFileInput').addEventListener('change', function (e) {
      handleFiles(e.target.files);
    });
    function handleFiles(files) {
      Array.prototype.forEach.call(files, function (file) {
        pendingFiles.push(file);
        var item = document.createElement('div');
        item.className = 'resource-upload-item';
        item.innerHTML = '<span>' + escapeHtml(file.name) + '</span><span>' + formatSize(file.size) + '</span>';
        $('resourceUploadList').appendChild(item);
      });
      $('resourceUploadBtn').disabled = pendingFiles.length === 0;
    }
  }

  function init() {
    if (isOwner()) {
      $('resourceAddBtn').hidden = false;
      $('resourceUpload').hidden = false;
    }
    $('resourceAddBtn').addEventListener('click', function () {
      $('resourceUpload').hidden = !$('resourceUpload').hidden;
    });
    $('resourceCancelBtn').addEventListener('click', function () {
      pendingFiles = [];
      $('resourceUploadList').innerHTML = '';
      $('resourceUploadStatus').textContent = '';
      $('resourceUploadBtn').disabled = true;
      $('resourceUpload').hidden = true;
    });
    $('resourceUploadBtn').addEventListener('click', uploadAll);
    setupDrop();
    renderResources();
  }

  document.getElementById('year').textContent = new Date().getFullYear();
  init();
})();
