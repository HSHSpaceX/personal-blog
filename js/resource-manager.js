// 资源管理器:弹窗内管理所有已上传资源,支持重命名、删除、排序、插入
(function () {
  'use strict';

  var OWNER = 'HSHSpaceX';
  var REPO = 'personal-blog';
  var BRANCH = 'main';

  function getToken() {
    try { return localStorage.getItem('blog-gh-token') || ''; } catch (e) { return ''; }
  }

  function apiHeaders() {
    return { Authorization: 'Bearer ' + getToken(), Accept: 'application/vnd.github+json' };
  }

  function collectAll() {
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
      var fileRe = /href="(assets\/[^"]+)"/gi;
      while ((m = fileRe.exec(html)) !== null) add(m[1], m[1].split('/').pop(), '文章附件: ' + p.title, p.date);
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

  // 资源中心弹窗
  function openResourceManager(onInsert) {
    var existing = document.getElementById('rm-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'rm-overlay';
    overlay.className = 'rm-overlay';
    overlay.innerHTML =
      '<div class="rm-modal">' +
        '<div class="rm-head">' +
          '<h2>资源管理</h2>' +
          '<button class="rm-close" type="button" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="rm-body" id="rmBody"></div>' +
        '<div class="rm-foot">' +
          '<button class="btn primary" id="rmInsert" type="button" disabled>插入所选</button>' +
          '<button class="btn" id="rmCancel" type="button">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var selected = null;
    var resources = collectAll();

    function renderList() {
      var body = document.getElementById('rmBody');
      if (!body) return;
      if (!resources.length) {
        body.innerHTML = '<p class="empty-state">还没有上传过任何资源。</p>';
        return;
      }
      body.innerHTML = resources.map(function (r, i) {
        var isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(r.path);
        var isVideo = /\.(mp4|mov|webm)$/i.test(r.path);
        return '<div class="rm-item' + (selected === i ? ' selected' : '') + '" data-rm-index="' + i + '">' +
          '<div class="rm-thumb">' +
            (isImage ? '<img src="' + r.path + '" alt="" loading="lazy">' : isVideo ? '<video src="' + r.path + '" muted playsinline></video>' : '<div class="rm-icon">📄</div>') +
          '</div>' +
          '<div class="rm-info">' +
            '<strong>' + escapeHtml(r.name) + '</strong>' +
            '<span>' + escapeHtml(r.source) + '</span>' +
            '<span class="rm-path">' + escapeHtml(r.path) + '</span>' +
          '</div>' +
          '<div class="rm-actions">' +
            '<button class="btn" type="button" data-rm-copy="' + escapeHtml(r.path) + '">复制链接</button>' +
            (onInsert ? '<button class="btn primary" type="button" data-rm-select="' + i + '">选择</button>' : '') +
            '<button class="btn danger" type="button" data-rm-del="' + i + '">删除</button>' +
          '</div>' +
        '</div>';
      }).join('');

      body.querySelectorAll('[data-rm-index]').forEach(function (el) {
        el.addEventListener('click', function () {
          selected = Number(el.getAttribute('data-rm-index'));
          document.querySelectorAll('.rm-item').forEach(function (item) {
            item.classList.toggle('selected', Number(item.getAttribute('data-rm-index')) === selected);
          });
          document.getElementById('rmInsert').disabled = selected === null;
        });
      });

      body.querySelectorAll('[data-rm-copy]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var full = 'https://raw.githubusercontent.com/HSHSpaceX/personal-blog/main/' + btn.getAttribute('data-rm-copy');
          navigator.clipboard.writeText(full).then(function () {
            btn.textContent = '已复制';
            setTimeout(function () { btn.textContent = '复制链接'; }, 1500);
          }).catch(function () {
            window.prompt('复制链接:', full);
          });
        });
      });

      body.querySelectorAll('[data-rm-del]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = Number(btn.getAttribute('data-rm-del'));
          var r = resources[idx];
          if (!window.confirm('确定删除 "' + r.name + '" 吗?')) return;
          // 从仓库中删除
          if (getToken()) {
            deleteResource(r.path).then(function () {
              resources.splice(idx, 1);
              selected = null;
              renderList();
            }).catch(function (err) {
              alert('删除失败: ' + err.message);
            });
          } else {
            resources.splice(idx, 1);
            selected = null;
            renderList();
          }
        });
      });
    }

    overlay.querySelector('.rm-close').addEventListener('click', function () {
      overlay.remove();
    });

    overlay.querySelector('#rmCancel').addEventListener('click', function () {
      overlay.remove();
    });

    overlay.querySelector('#rmInsert').addEventListener('click', function () {
      if (selected === null) return;
      var r = resources[selected];
      overlay.remove();
      if (onInsert) onInsert(r);
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    renderList();
  }

  function deleteResource(path) {
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path + '?ref=' + BRANCH, {
      headers: apiHeaders()
    }).then(function (res) {
      if (!res.ok) throw new Error('获取文件信息失败: ' + res.status);
      return res.json();
    }).then(function (meta) {
      return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path, {
        method: 'DELETE',
        headers: Object.assign({ 'Content-Type': 'application/json' }, apiHeaders()),
        body: JSON.stringify({ message: '删除资源: ' + path, sha: meta.sha, branch: BRANCH })
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('删除失败: ' + res.status);
    });
  }

  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.ResourceManager = { open: openResourceManager, collect: collectAll };
})();
