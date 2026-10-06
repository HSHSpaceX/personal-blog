(function () {
  'use strict';
  var auth = window.BlogAuth, data = window.BlogData;
  window.BlogTheme.setup();
  var $ = function (id) { return document.getElementById(id); };
  var target = null;
  function status(text, kind) { $('profileStatus').textContent = text; $('profileStatus').className = 'status-line' + (kind ? ' ' + kind : ''); }
  async function load() {
    try {
      await auth.ready();
      if (!auth.configured()) { status('用户资料暂不可用：Supabase 尚未配置。', 'err'); return; }
      var params = new URLSearchParams(location.search);
      var id = params.get('id');
      if (!id && params.get('username')) {
        var result = await auth.client().from('profiles').select('id').eq('username', params.get('username')).maybeSingle();
        if (result.error) throw result.error;
        id = result.data && result.data.id;
      }
      if (!id && auth.user()) id = auth.user().id;
      if (!id) { location.replace('login.html?next=profile.html'); return; }
      target = await data.getProfile(id);
      if (!target) { status('找不到该用户资料。', 'err'); return; }
      var own = !!auth.user() && auth.user().id === target.id;
      $('profileHeading').textContent = own ? '我的资料' : '用户资料';
      $('profileName').textContent = target.display_name || target.username;
      $('profileUsername').textContent = '@' + target.username;
      $('profileBio').textContent = target.bio || '还没有简介。';
      if (target.avatar_url) $('profileAvatar').src = target.avatar_url;
      $('profileEditor').hidden = !own;
      $('profileLogout').hidden = !own;
      var adminLinks = $('profileAdminLinks');
      adminLinks.replaceChildren();
      if (own && auth.isAdmin()) {
        var adminLink = document.createElement('a');
        adminLink.className = 'btn'; adminLink.href = 'admin.html';
        adminLink.rel = 'nofollow'; adminLink.textContent = '管理后台';
        adminLinks.appendChild(adminLink);
      }
      if (own) {
        $('profileUsernameInput').value = target.username;
        $('profileDisplayInput').value = target.display_name;
        $('profileBioInput').value = target.bio;
      } else {
        $('followBtn').hidden = false;
        var following = await data.following(id);
        $('followBtn').textContent = following ? '取消关注' : '关注';
      }
      var counts = await Promise.all([
        data.followerCount(id),
        data.userLikeCount(id)
      ]);
      $('profileCounts').textContent = counts[0] + ' 位关注者 · 已点赞 ' + counts[1] + ' 次';
    } catch (error) { status(error.message, 'err'); }
  }
  $('profileSave').addEventListener('click', async function () {
    try {
      var username = $('profileUsernameInput').value.trim();
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) throw new Error('用户名须为 3–30 个英文、数字或下划线。');
      $('profileSave').disabled = true;
      await data.saveProfile({ username: username, display_name: $('profileDisplayInput').value.trim(), bio: $('profileBioInput').value.trim() });
      var file = $('profileAvatarInput').files[0];
      if (file) await data.uploadAvatar(file);
      status('资料已保存。', 'ok');
      await load();
    } catch (error) { status(error.message, 'err'); }
    finally { $('profileSave').disabled = false; }
  });
  $('followBtn').addEventListener('click', async function () {
    try {
      if (!auth.user()) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
      $('followBtn').disabled = true;
      var now = await data.toggleFollow(target.id);
      $('followBtn').textContent = now ? '取消关注' : '关注';
      await load();
    } catch (error) { status(error.message, 'err'); }
    finally { $('followBtn').disabled = false; }
  });
  $('profileLogout').addEventListener('click', async function () { await auth.signOut(); location.replace('index.html'); });
  document.addEventListener('blog-auth-change', function () { $('profileAdminLinks').replaceChildren(); });
  load();
})();
