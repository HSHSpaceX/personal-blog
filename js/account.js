(function () {
  'use strict';
  var auth = window.BlogAuth;
  var data = window.BlogData;
  var initialized = false;
  var generation = 0;
  var $ = function (id) { return document.getElementById(id); };
  var workspace = window.AccountWorkspace ? window.AccountWorkspace.create({root:$('accountSections'),nav:$('accountDirectory'),toggle:$('directoryToggle'),backdrop:$('directoryBackdrop'),beforeLeave:function(){return !window.CommunityUI||window.CommunityUI.confirmLeave();}}) : null;
  if (workspace) window.AccountRoute = workspace;
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
    if (window.AssetCenter) window.AssetCenter.clear();
    if (window.AccountComments) window.AccountComments.clear();
    $('accountSections').hidden = true;
    if (workspace) workspace.setEnabled(false);
    $('accountIdentity').textContent = '';
    $('accountSummary').textContent = '';
    $('accountNotificationCount').textContent='';$('accountDMCount').textContent='';
    $('accountConnections').textContent = '在公开主页查看关注与粉丝列表。';
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
      link($('accountAdminNav'), 'admin.html#pages', '站点页面管理');
      link($('accountAdminNav'), 'admin.html', 'Legacy 内容管理');
      link($('accountReviewLinks'), 'admin.html#messages', '现有评论审核');
      link($('accountReviewLinks'), 'admin.html', '管理后台');
      if (!workspace) { $('review-center').hidden = false; $('review-policies').hidden = false; }
    }
    if (workspace) {
      $('accountAdminNav').querySelectorAll('a').forEach(function(a){a.className='';var route=a.hash.slice(1);if(a.pathname.endsWith('/account.html'))a.dataset.workspaceRoute=route;var icon=document.createElement('span');icon.dataset.menuIcon='';icon.setAttribute('aria-hidden','true');icon.textContent='◇';a.prepend(icon);});
      workspace.setEnabled(true);
    }
    status('欢迎回到账号中心。', 'ok');
    if (window.CommunityUI) window.CommunityUI.refresh();
    if (window.AssetCenter) window.AssetCenter.refresh();
    if (window.AccountComments) window.AccountComments.refresh();
    try {
      var results = await Promise.allSettled([data.getProfile(user.id), data.notificationCount(), data.followerCount(user.id), data.dmUnreadCount()]);
      if (generation !== attempt || !auth.user() || auth.user().id !== user.id) return;
      var values=results.map(function(r){return r.status==='fulfilled'?r.value:null;});
      var profile = values[0];
      $('accountSummary').textContent = (profile && (profile.display_name || profile.username) || '用户') + ' · ' + (values[1]===null?'通知暂不可用':values[1]+' 条未读通知') + ' · ' + (values[3]===null?'私信暂不可用':values[3]+' 条未读私信');
      $('accountNotificationCount').textContent=values[1]===null?'通知暂不可用':values[1]+' 条未读通知';$('accountDMCount').textContent=values[3]===null?'私信暂不可用':values[3]+' 条未读私信';
      $('accountConnections').textContent = values[2]===null?'关注信息暂不可用':values[2] + ' 位关注者。在公开主页查看关注与粉丝列表。';
      var failed=results.find(function(r){return r.status==='rejected';});if(failed)status('部分功能暂不可用：'+(window.CommunityData&&window.CommunityData.errorMessage?window.CommunityData.errorMessage(failed.reason):failed.reason.message),'err');
    } catch (error) {
      if (generation === attempt) status('账号概览暂不可用：' + error.message, 'err');
    }
  }
  document.addEventListener('blog-auth-change', function () {
    clear();
    if (initialized) render();
  });
  if (workspace) window.addEventListener('message',function(event){
    if(event.origin!==location.origin || !event.data || event.data.type!=='account-frame-height' || !Number.isFinite(event.data.height))return;
    document.querySelectorAll('iframe[data-account-frame]').forEach(function(frame){if(frame.contentWindow===event.source)frame.style.height=Math.max(480,Math.min(12000,event.data.height+24))+'px';});
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
