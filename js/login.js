(function () {
  'use strict';
  var auth = window.BlogAuth;
  var email = document.getElementById('email');
  var password = document.getElementById('password');
  var status = document.getElementById('loginStatus');
  var reset = new URLSearchParams(location.search).has('reset');
  function message(text, kind) { status.textContent = text; status.className = 'status-line' + (kind ? ' ' + kind : ''); }
  function returnUrl() {
    var next = new URLSearchParams(location.search).get('next');
    return next && /^\/?[a-z0-9/_#.?=&%-]+$/i.test(next) && !next.startsWith('//') ? next : 'profile.html';
  }
  auth.ready().then(function () {
    if (!auth.configured()) message('登录暂未开放：站点尚未配置 Supabase。', 'err');
    else if (auth.user() && !reset) location.replace(returnUrl());
    if (reset) {
      document.getElementById('loginHeading').textContent = '设置新密码';
      document.getElementById('emailField').hidden = true;
      document.getElementById('loginBtn').textContent = '保存新密码';
      message('请通过邮件中的重置链接打开本页。');
    }
  }).catch(function (error) { message(error.message, 'err'); });
  var join = document.getElementById('joinRequest');
  var joinUrl = (window.BlogConfig || {}).JOIN_REQUEST_URL;
  if (joinUrl && /^https:\/\//.test(joinUrl)) { join.href = joinUrl; join.hidden = false; }
  document.getElementById('loginBtn').addEventListener('click', async function () {
    try {
      if (password.value.length < 1) throw new Error('请输入密码。');
      message('正在验证…');
      if (reset) { await auth.updatePassword(password.value); message('密码已更新，请重新登录。', 'ok'); location.replace('login.html'); }
      else { if (!email.value.trim()) throw new Error('请输入邮箱。'); await auth.signIn(email.value.trim(), password.value); location.replace(returnUrl()); }
    } catch (error) { message(error.message, 'err'); }
  });
  document.getElementById('forgotBtn').addEventListener('click', async function () {
    try {
      if (!email.value.trim()) throw new Error('先填写邮箱，再点击忘记密码。');
      await auth.resetPassword(email.value.trim());
      message('若邮箱已有账号，重置链接将发送到该邮箱。', 'ok');
    } catch (error) { message(error.message, 'err'); }
  });
  password.addEventListener('keydown', function (event) { if (event.key === 'Enter') document.getElementById('loginBtn').click(); });
})();
