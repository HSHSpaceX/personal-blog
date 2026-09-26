(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function compressImage(file, maxSize) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var canvas = document.createElement('canvas');
        var scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  var pendingAvatar = null;

  function render() {
    var acc = window.ReaderAccount ? window.ReaderAccount.load() : null;
    var isOwner = window.ReaderAccount ? window.ReaderAccount.isOwner() : false;

    $('profileName').textContent = (isOwner ? 'HSH(站长)' : (acc && acc.name) || '访客');
    $('profileAvatar').src = (isOwner ? 'assets/icon.jpg' : (acc && acc.avatar) || 'assets/avatar-default.jpg');
    $('profileBio').textContent = (isOwner ? '博主' : (acc && acc.bio) || '还没有介绍。');
    $('profileBio').style.display = 'block';

    // 统计
    var comments = window.SITE_COMMENTS || {};
    var commentCount = 0;
    Object.keys(comments).forEach(function (slug) {
      (comments[slug] || []).forEach(function (c) {
        if (isOwner ? c.nick === 'HSH(站长)' : (acc && c.nick === acc.name)) commentCount++;
      });
    });
    $('profileComments').textContent = commentCount;

    var moments = window.BLOG_MOMENTS || [];
    var likeCount = moments.filter(function (m) {
      if (isOwner) return true;
      return acc && acc.likes.indexOf('moment-' + m.id) !== -1;
    }).length;
    $('profileLikes').textContent = likeCount;

    $('profileFollowState').textContent = (acc && acc.following) ? '已关注' : '未关注';

    // 按钮
    var actions = $('profileActions');
    actions.innerHTML = '';
    if (isOwner) {
      actions.innerHTML = '<a class="btn primary" href="admin.html">管理后台</a><a class="btn" href="moments.html">我的动态</a>';
    } else if (!acc || !acc.name) {
      actions.innerHTML = '<a class="btn primary" href="login.html">登录后编辑资料</a>';
    } else {
      var edit = document.createElement('button');
      edit.className = 'btn';
      edit.textContent = '编辑资料';
      edit.addEventListener('click', function () {
        $('profileEdit').hidden = false;
        actions.hidden = true;
        $('profileNameInput').value = acc.name || '';
        $('profileBioInput').value = acc.bio || '';
        $('avatarPreview').src = acc.avatar || 'assets/avatar-default.jpg';
      });
      actions.appendChild(edit);

      var followBtn = document.createElement('button');
      followBtn.className = acc.following ? 'btn' : 'btn primary';
      followBtn.textContent = acc.following ? '取消关注' : '关注博主';
      followBtn.addEventListener('click', function () {
        var now = window.ReaderAccount.toggleFollow();
        followBtn.className = now ? 'btn' : 'btn primary';
        followBtn.textContent = now ? '取消关注' : '关注博主';
        $('profileFollowState').textContent = now ? '已关注' : '未关注';
      });
      actions.appendChild(followBtn);

      var logout = document.createElement('button');
      logout.className = 'btn danger';
      logout.textContent = '退出登录';
      logout.addEventListener('click', function () {
        window.ReaderAccount.logout();
        window.location.reload();
      });
      actions.appendChild(logout);
    }

    $('profileNameInput').value = (acc && acc.name) || '';
  }

  $('profileSaveBtn').addEventListener('click', function () {
    var name = $('profileNameInput').value.trim();
    var bio = $('profileBioInput').value.trim();
    if (!name) {
      $('profileStatus').textContent = '请填写用户名。';
      $('profileStatus').classList.add('err');
      return;
    }
    var acc = window.ReaderAccount.load();
    window.ReaderAccount.login(name, pendingAvatar || acc.avatar);
    window.ReaderAccount.setBio(bio);
    $('profileStatus').textContent = '已保存。';
    $('profileStatus').classList.add('ok');
    $('profileEdit').hidden = true;
    $('profileActions').hidden = false;
    render();
  });

  $('profileCancelBtn').addEventListener('click', function () {
    $('profileEdit').hidden = true;
    $('profileActions').hidden = false;
    pendingAvatar = null;
  });

  $('avatarUploadBtn').addEventListener('click', function () {
    $('avatarInput').click();
  });

  $('avatarInput').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    compressImage(file, 128).then(function (dataUrl) {
      if (dataUrl) {
        pendingAvatar = dataUrl;
        $('avatarPreview').src = dataUrl;
      }
    });
  });

  document.getElementById('year').textContent = new Date().getFullYear();
  render();
})();
