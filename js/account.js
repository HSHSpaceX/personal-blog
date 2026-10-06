(function () {
  'use strict';
  var auth = window.BlogAuth;
  var data = window.BlogData;
  var initialized = false;
  var generation = 0;
  var $ = function (id) { return document.getElementById(id); };
  window.BlogTheme.setup();
  function status(text, kind) {
    $('accountStatus').textContent = text;
    $('accountStatus').className = 'status-line' + (kind ? ' ' + kind : '');
  }
  function link(slot, href, label) {
    var anchor = document.createElement('a');
    anchor.className = 'btn'; anchor.href = href; anchor.rel = 'nofollow';
    anchor.textContent = label; slot.appendChild(anchor);
  }
  function clear() {
    generation++;
    if (window.CommunityUI) window.CommunityUI.clear();
    $('accountSections').hidden = true;
    $('accountIdentity').textContent = '';
    $('accountSummary').textContent = '';
    $('accountConnections').textContent = '完整关注与粉丝列表将在后续开放。';
    $('accountAdminNav').replaceChildren();
    $('accountReviewLinks').replaceChildren();
    $('review-center').hidden = true;
    $('review-policies').hidden = true;
  }
  async function render() {
    clear();
    var attempt = generation;
    var user = auth.user();
    if (!user) { location.replace('login.html?next=account.html'); return; }
    $('accountSections').hidden = false;
    $('accountIdentity').textContent = auth.isAdmin() ? '管理员账号 · 保留全部用户社交能力' : '邀请制用户账号';
    if (auth.isAdmin()) {
      link($('accountAdminNav'), 'account.html#review-center', '审核中心');
      link($('accountAdminNav'), 'account.html#review-policies', '审核规则');
      link($('accountReviewLinks'), 'admin.html#messages', '现有评论审核');
      link($('accountReviewLinks'), 'admin.html', '管理后台');
      $('review-center').hidden = false;
      $('review-policies').hidden = false;
    }
    status('欢迎回到账号中心。', 'ok');
    if (window.CommunityUI) window.CommunityUI.refresh();
    try {
      var values = await Promise.all([data.getProfile(user.id), data.notificationCount(), data.followerCount(user.id)]);
      if (generation !== attempt || !auth.user() || auth.user().id !== user.id) return;
      var profile = values[0];
      $('accountSummary').textContent = (profile && (profile.display_name || profile.username) || '用户') + ' · ' + values[1] + ' 条未读通知';
      $('accountConnections').textContent = values[2] + ' 位关注者。完整关注与粉丝列表将在后续开放。';
    } catch (error) {
      if (generation === attempt) status('账号概览暂不可用：' + error.message, 'err');
    }
  }
  document.addEventListener('blog-auth-change', function () {
    clear();
    if (initialized) render();
  });
  $('accountResetPassword').addEventListener('click', async function () {
    try {
      var user = auth.requireUser();
      if (!user.email) throw new Error('当前账号没有可用邮箱。');
      $('accountResetPassword').disabled = true;
      await auth.resetPassword(user.email);
      if (auth.user() && auth.user().id === user.id) status('密码重置邮件已发送，请查收。', 'ok');
    } catch (error) { status(error.message, 'err'); }
    finally { $('accountResetPassword').disabled = false; }
  });
  $('accountLogout').addEventListener('click', async function () {
    clear();
    if (window.GitHubCredentials) window.GitHubCredentials.clear();
    try { await auth.signOut(); location.replace('index.html'); }
    catch (error) { status('退出登录未完成：' + error.message, 'err'); }
  });
  auth.ready().then(function () { initialized = true; render(); }).catch(function (error) {
    clear(); status('无法确认登录状态：' + error.message, 'err');
  });
})();
