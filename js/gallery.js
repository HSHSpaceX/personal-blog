(function () {
  'use strict';

  var OWNER = 'HSHSpaceX';
  var REPO = 'personal-blog';
  var BRANCH = 'main';
  var ALBUMS_PATH = 'js/albums.js';

  var albums = window.SITE_ALBUMS || [];
  var currentAlbumId = new URLSearchParams(window.location.search).get('album');
  var lightboxIndex = 0;
  var slideshowTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function isAuthed() {
    try {
      return Number(localStorage.getItem('blog-auth') || 0) > Date.now();
    } catch (e) {
      return false;
    }
  }

  function getToken() {
    try {
      return localStorage.getItem('blog-gh-token') || '';
    } catch (e) {
      return '';
    }
  }

  function rawUrl(path) {
    return 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/' + path;
  }

  function uid() {
    return 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function setStatus(message, kind) {
    var el = $('galleryStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  function currentAlbum() {
    return albums.filter(function (album) { return album.id === currentAlbumId; })[0] || null;
  }

  function visibleAlbums() {
    return albums.filter(function (album) {
      return album.visibility !== 'private' || isAuthed();
    });
  }

  function saveAlbums(message) {
    var token = getToken();
    if (!token) throw new Error('需要先在后台连接 GitHub Token');
    var headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    };
    var text = '/* 图册数据：在画廊页右上角“+”创建和管理。 */\nwindow.SITE_ALBUMS = ' + JSON.stringify(albums, null, 2) + ';\n';
    var content = btoa(unescape(encodeURIComponent(text)));
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + ALBUMS_PATH + '?ref=' + BRANCH, { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('GitHub ' + res.status);
        return res.json();
      })
      .then(function (meta) {
        return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + ALBUMS_PATH, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify({
            message: message,
            content: content,
            branch: BRANCH,
            sha: meta.sha
          })
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error('GitHub ' + res.status);
        window.SITE_ALBUMS = albums;
      });
  }

  function putFile(path, base64, message) {
    var headers = {
      Authorization: 'Bearer ' + getToken(),
      Accept: 'application/vnd.github+json'
    };
    var body = {
      message: message,
      content: base64,
      branch: BRANCH
    };
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 422) {
        return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path + '?ref=' + BRANCH, { headers: headers })
          .then(function (metaRes) { return metaRes.json(); })
          .then(function (meta) {
            body.sha = meta.sha;
            return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path, {
              method: 'PUT',
              headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
              body: JSON.stringify(body)
            });
          });
      }
      return res;
    }).then(function (res) {
      if (!res.ok) throw new Error('GitHub ' + res.status);
    });
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function () {
        reject(new Error('读取文件失败'));
      };
      reader.readAsDataURL(file);
    });
  }

  function renderGrid() {
    var grid = $('galleryGrid');
    var list = visibleAlbums();
    if (list.length === 0) {
      grid.innerHTML = '<p class="empty-state">还没有图册' + (isAuthed() ? '，点击右上角“+”创建一个。' : '。') + '</p>';
      return;
    }
    grid.innerHTML = list.map(function (album) {
      var cover = album.photos[0] ? '<img src="' + escapeHtml(album.photos[0].src) + '" alt="" loading="lazy">' : '<div class="album-cover-empty">暂无照片</div>';
      var badge = album.visibility === 'private' ? '<span class="album-badge">仅我可见</span>' : '';
      return '' +
        '<a class="album-card" href="gallery.html?album=' + encodeURIComponent(album.id) + '">' +
          '<div class="album-cover">' + cover + '</div>' +
          '<div class="album-card-body">' +
            '<div class="album-card-title-row"><h3>' + escapeHtml(album.title) + '</h3>' + badge + '</div>' +
            '<div class="album-card-meta"><span>' + album.photos.length + ' 张照片</span><span>' + escapeHtml(album.created || '') + '</span></div>' +
          '</div>' +
        '</a>';
    }).join('');
  }

  function renderAlbumView(albumId) {
    var album = albums.filter(function (item) { return item.id === albumId; })[0];
    var view = $('albumView');
    var authed = isAuthed();
    if (!album || (album.visibility === 'private' && !authed)) {
      view.hidden = false;
      $('galleryGrid').innerHTML = '';
      $('albumTitle').textContent = '图册不存在或不可见';
      $('albumMeta').innerHTML = '';
      $('albumActions').innerHTML = '';
      $('photoGrid').innerHTML = '<p class="empty-state">内容不可用。</p>';
      return;
    }
    currentAlbumId = album.id;
    view.hidden = false;
    $('galleryGrid').innerHTML = '';
    $('albumTitle').textContent = album.title;
    $('albumMeta').innerHTML = album.photos.length + ' 张照片 · ' + (album.visibility === 'private' ? '仅我可见' : '公开');

    var actions = $('albumActions');
    actions.innerHTML = '';
    if (authed) {
      actions.appendChild(createActionButton('上传照片', function () { $('galleryFileInput').click(); }));
      actions.appendChild(createActionButton(album.visibility === 'private' ? '设为公开' : '设为仅我可见', function () {
        album.visibility = album.visibility === 'private' ? 'public' : 'private';
        saveAlbums('更新图册可见性：' + album.title).then(function () {
          setStatus('可见性已更新。', 'ok');
          renderAlbumView(album.id);
        }).catch(function (e) {
          album.visibility = album.visibility === 'private' ? 'public' : 'private';
          setStatus('更新失败：' + e.message, 'err');
        });
      }));
      actions.appendChild(createActionButton('删除图册', function () {
        if (!window.confirm('确定删除图册《' + album.title + '》？照片文件会保留在仓库中。')) return;
        albums = albums.filter(function (item) { return item.id !== album.id; });
        saveAlbums('删除图册：' + album.title).then(function () {
          window.location.href = 'gallery.html';
        }).catch(function (e) {
          albums.push(album);
          setStatus('删除失败：' + e.message, 'err');
        });
      }, true));
    }

    var grid = $('photoGrid');
    grid.innerHTML = album.photos.map(function (photo, index) {
      var del = authed ? '<button class="photo-del" type="button" data-del-photo="' + index + '" aria-label="删除这张照片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : '';
      return '<figure class="photo-item">' +
        '<img src="' + escapeHtml(photo.src) + '" alt="" loading="lazy" data-photo-index="' + index + '">' +
        del +
      '</figure>';
    }).join('');
    if (authed) {
      var uploadBtn = createActionButton('上传照片', function () { $('galleryFileInput').click(); });
      grid.before(uploadBtn);
    }
  }

  function createActionButton(label, onClick, danger) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function refreshPlusVisibility() {
    var plus = $('galleryPlus');
    if (plus) plus.hidden = !isAuthed();
  }

  function render() {
    if (currentAlbumId) renderAlbumView(currentAlbumId);
    else renderGrid();
  }

  function openLightbox(index) {
    var album = currentAlbum();
    if (!album || album.photos.length === 0) return;
    lightboxIndex = index;
    updateLightbox();
    $('lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function updateLightbox() {
    var album = currentAlbum();
    if (!album) return;
    var photo = album.photos[lightboxIndex];
    $('lightboxImg').src = photo.src;
    $('lightboxCaption').textContent = photo.caption || '';
    $('lightboxCounter').textContent = (lightboxIndex + 1) + ' / ' + album.photos.length;
  }

  function closeLightbox() {
    stopSlideshow();
    $('lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  function nextPhoto() {
    var album = currentAlbum();
    if (!album || album.photos.length === 0) return;
    lightboxIndex = (lightboxIndex + 1) % album.photos.length;
    updateLightbox();
  }

  function prevPhoto() {
    var album = currentAlbum();
    if (!album || album.photos.length === 0) return;
    lightboxIndex = (lightboxIndex - 1 + album.photos.length) % album.photos.length;
    updateLightbox();
  }

  function toggleSlideshow() {
    if (slideshowTimer) {
      stopSlideshow();
    } else {
      slideshowTimer = window.setInterval(nextPhoto, 3000);
      $('lightboxPlay').classList.add('playing');
    }
  }

  function stopSlideshow() {
    if (slideshowTimer) {
      window.clearInterval(slideshowTimer);
      slideshowTimer = null;
      $('lightboxPlay').classList.remove('playing');
    }
  }

  function createAlbum(title, visibility) {
    var album = {
      id: uid(),
      title: title,
      visibility: visibility,
      photos: [],
      created: new Date().toISOString().slice(0, 10)
    };
    albums.push(album);
    return saveAlbums('创建图册：' + title).then(function () {
      window.location.href = 'gallery.html?album=' + encodeURIComponent(album.id);
    }).catch(function (e) {
      albums = albums.filter(function (item) { return item.id !== album.id; });
      throw e;
    });
  }

  async function uploadPhotos(files) {
    var album = currentAlbum();
    if (!album) return;
    var token = getToken();
    if (!token) {
      setStatus('需要先在后台连接 GitHub Token 才能上传。', 'err');
      return;
    }
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      setStatus('上传中 ' + (i + 1) + '/' + files.length + '…');
      try {
        var extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
        if (!/^(jpg|jpeg|png|webp|gif|avif)$/i.test(extension)) extension = 'jpg';
        if (file.size > 90 * 1024 * 1024) throw new Error('文件超过 90MB');
        var path = 'assets/gallery/' + album.id + '/' + uid() + '.' + extension;
        var base64 = await fileToBase64(file);
        await putFile(path, base64, '上传照片：' + album.title);
        album.photos.push({ src: rawUrl(path), caption: '' });
      } catch (e) {
        setStatus('第 ' + (i + 1) + ' 张上传失败：' + e.message, 'err');
      }
    }
    setStatus('正在保存图册…');
    try {
      await saveAlbums('更新图册照片：' + album.title);
      setStatus('上传完成。', 'ok');
    } catch (e) {
      setStatus('保存失败：' + e.message, 'err');
    }
    renderAlbumView(album.id);
  }

  function setup() {
    var yearEl = $('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    refreshPlusVisibility();
    render();

    $('galleryPlus').addEventListener('click', function () {
      if (!isAuthed()) {
        window.location.href = 'login.html';
        return;
      }
      $('albumModal').hidden = false;
      $('albumTitleInput').focus();
    });

    $('albumCancelBtn').addEventListener('click', function () {
      $('albumModal').hidden = true;
    });

    $('albumCreateBtn').addEventListener('click', function () {
      var title = $('albumTitleInput').value.trim();
      if (!title) {
        setStatus('请填写图册名称。', 'err');
        return;
      }
      setStatus('正在创建…');
      createAlbum(title, $('albumVisibility').value).catch(function (e) {
        setStatus('创建失败：' + e.message, 'err');
      });
    });

    $('galleryFileInput').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files);
      this.value = '';
      if (files.length) uploadPhotos(files);
    });

    $('photoGrid').addEventListener('click', function (event) {
      var img = event.target.closest('img[data-photo-index]');
      if (img) {
        openLightbox(Number(img.dataset.photoIndex));
        return;
      }
      var del = event.target.closest('.photo-del');
      if (del) {
        var album = currentAlbum();
        var index = Number(del.dataset.delPhoto);
        if (!album || !window.confirm('确定删除这张照片？')) return;
        album.photos.splice(index, 1);
        setStatus('正在保存…');
        saveAlbums('删除图册照片：' + album.title).then(function () {
          setStatus('已删除。', 'ok');
          renderAlbumView(album.id);
        }).catch(function (e) {
          setStatus('删除失败：' + e.message, 'err');
        });
      }
    });

    $('lightboxClose').addEventListener('click', closeLightbox);
    $('lightboxPrev').addEventListener('click', prevPhoto);
    $('lightboxNext').addEventListener('click', nextPhoto);
    $('lightboxPlay').addEventListener('click', toggleSlideshow);
    $('lightbox').addEventListener('click', function (event) {
      if (event.target === $('lightbox')) closeLightbox();
    });
    document.addEventListener('keydown', function (event) {
      if ($('lightbox').hidden) return;
      if (event.key === 'Escape') closeLightbox();
      if (event.key === 'ArrowRight') nextPhoto();
      if (event.key === 'ArrowLeft') prevPhoto();
      if (event.key === ' ') {
        event.preventDefault();
        toggleSlideshow();
      }
    });
  }

  function boot() {
    albums = window.SITE_ALBUMS || [];
    setup();
  }

  if (window.SITE_ALBUMS) {
    boot();
  } else {
    document.addEventListener('posts-ready', boot);
  }
})();
