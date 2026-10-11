(function () {
  'use strict';

  var albums = window.SITE_ALBUMS || [];
  var currentAlbumId = new URLSearchParams(window.location.search).get('community') || new URLSearchParams(window.location.search).get('album');
  function allAlbums(){return window.CommunityPublic?window.CommunityPublic.mergeAlbums(albums):albums;}
  function albumURL(a){return 'gallery.html?'+(a.community?'community=':'album=')+encodeURIComponent(a.id);}
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

  function isAuthed() { return window.BlogAuth.isAdmin(); }
  function canEdit() { return false; }

  function setStatus(message, kind) {
    var el = $('galleryStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  function currentAlbum() {
    return allAlbums().filter(function (album) { return album.id === currentAlbumId; })[0] || null;
  }

  function visibleAlbums() {
    return allAlbums().filter(function (album) {
      return album.visibility !== 'private' || isAuthed();
    });
  }

  function renderGrid() {
    var grid = $('galleryGrid');
    var list = visibleAlbums();
    if (list.length === 0) {
      grid.innerHTML = '<p class="empty-state">还没有图册' + (canEdit() ? '，点击右上角“+”创建一个。' : '。') + '</p>';
      return;
    }
    grid.innerHTML = list.map(function (album) {
      var cover = album.photos[0] ? '<img src="' + escapeHtml(album.photos[0].src) + '" alt="'+escapeHtml(album.title)+'" loading="lazy">' : '<div class="album-cover-empty">暂无照片</div>';
      var badge = album.visibility === 'private' ? '<span class="album-badge">仅我可见</span>' : '';
      var menuBtn = canEdit() && !album.community ? '<button class="album-menu-btn" type="button" data-menu-album="' + escapeHtml(album.id) + '" aria-label="图册菜单" aria-haspopup="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>' : '';
      return '' +
        '<div class="album-card">' +
          '<a class="album-cover-link" href="' + albumURL(album) + '"><div class="album-cover">' + cover + '</div></a>' +
          menuBtn +
          '<div class="album-card-body">' +
            '<div class="album-card-title-row"><h3><a href="' + albumURL(album) + '">' + escapeHtml(album.title) + '</a></h3>' + badge + '</div>' +
            (window.PublicCards?window.PublicCards.author(album.author_profile||{username:'hshspacex',display_name:'HSH(站长)',avatar_url:'assets/icon.jpg'}).outerHTML:'<a href="profile.html?username=hshspacex">HSH(站长) / @hshspacex</a>') +
            '<div class="album-card-meta"><span>' + album.photos.length + ' 张照片</span><span>' + escapeHtml(album.created || '') + '</span></div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  var menuAlbumId = null;

  function renderAlbumView(albumId) {
    var album = allAlbums().filter(function (item) { return item.id === albumId; })[0];
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
    if(window.CommunityDiscussion)window.CommunityDiscussion.show(album.community?album.id:null);
    view.hidden = false;
    $('galleryGrid').innerHTML = '';
    $('albumTitle').textContent = album.title;
    $('albumMeta').innerHTML = (window.PublicCards?window.PublicCards.author(album.author_profile||{username:'hshspacex',display_name:'HSH(站长)',avatar_url:'assets/icon.jpg'}).outerHTML:'')+album.photos.length + ' 张照片 · ' + (album.visibility === 'private' ? '仅我可见' : '公开');

    if(album.description){var description=document.createElement('p');description.className='public-text';if(album.public_item&&album.public_item.body.document&&window.CommunityPublic){description=document.createElement('div');description.className='public-text prose';description.innerHTML=window.CommunityPublic.bodyHTML(album.public_item);}else description.textContent=album.description;$('albumMeta').appendChild(description);}
    var actions = $('albumActions');
    actions.innerHTML = '';
    actions.hidden = !canEdit() || album.community;
    var grid = $('photoGrid');
    grid.innerHTML = album.photos.map(function (photo, index) {
      var del = canEdit() && !album.community ? '<button class="photo-del" type="button" data-del-photo="' + index + '" aria-label="删除这张照片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : '';
      return '<figure class="photo-item">' +
        '<img src="' + escapeHtml(photo.src) + '" alt="'+escapeHtml(photo.caption||album.title)+'" loading="lazy" data-photo-index="' + index + '">' +
        del + (photo.caption?'<figcaption>'+escapeHtml(photo.caption)+'</figcaption>':'') +
      '</figure>';
    }).join('');
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
    if ($('galleryPlus')) $('galleryPlus').hidden = !window.BlogAuth.user();
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

  function setup() {
    render();refreshPlusVisibility();document.addEventListener('blog-auth-change',function(){refreshPlusVisibility();render();});
    $('galleryPlus').addEventListener('click',function(){location.assign('account.html#albums');});
    $('photoGrid').addEventListener('click',function(event){var img=event.target.closest('img[data-photo-index]');if(img)openLightbox(Number(img.dataset.photoIndex));});
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

  if (window.SITE_ALBUMS && (!window.CommunityPublic || window.COMMUNITY_PUBLIC)) {
    boot();
  } else {
    document.addEventListener('posts-ready', boot);
  }
})();
