(function () {
  'use strict';
  var token = '';
  var ownerId = null;
  var generation = 0;
  // Erase plaintext PATs left by earlier versions. New PATs stay in memory only.
  try { localStorage.removeItem('blog-gh-token'); } catch (e) { /* storage unavailable */ }
  try { sessionStorage.removeItem('blog-gh-pat-session'); } catch (e) { /* storage unavailable */ }
  function clear() {
    generation++;
    token = '';
    ownerId = null;
    document.querySelectorAll('[data-github-pat]').forEach(function (input) { input.value = ''; });
  }
  function get() { return window.BlogAuth.isAdmin() && window.BlogAuth.user().id === ownerId ? token : ''; }
  async function validate(value) {
    window.BlogAuth.requireAdmin();
    var cfg = window.BlogConfig;
    var headers = { Authorization: 'Bearer ' + value, Accept: 'application/vnd.github+json' };
    var who = await fetch('https://api.github.com/user', { headers: headers });
    if (!who.ok) throw new Error('GitHub /user 验证失败：' + who.status);
    window.BlogAuth.requireAdmin();
    var repo = await fetch('https://api.github.com/repos/' + encodeURIComponent(cfg.GITHUB_OWNER) + '/' + encodeURIComponent(cfg.GITHUB_REPO), { headers: headers });
    if (!repo.ok) throw new Error('无法访问目标仓库：' + repo.status);
    var info = await repo.json();
    if (!info.permissions || !info.permissions.push) throw new Error('PAT 没有目标仓库的写入权限。');
    window.BlogAuth.requireAdmin();
    return who.json();
  }
  async function connect(value) {
    if (!value) throw new Error('请输入 PAT。');
    clear();
    var attempt = generation;
    var actorId = window.BlogAuth.requireUser().id;
    await validate(value);
    window.BlogAuth.requireAdmin();
    if (attempt !== generation || window.BlogAuth.requireUser().id !== actorId) throw new Error('登录状态已变化，请重新连接 PAT。');
    token = value;
    ownerId = actorId;
  }
  document.addEventListener('blog-auth-change', function () {
    if (!window.BlogAuth.isAdmin() || (ownerId && window.BlogAuth.user().id !== ownerId)) clear();
  });
  window.addEventListener('pagehide', clear);
  window.GitHubCredentials = { get: get, clear: clear, connect: connect, validate: validate };
})();
