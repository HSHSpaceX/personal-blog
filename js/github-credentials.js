(function () {
  'use strict';
  var KEY = 'blog-gh-pat-session';
  var token = '';
  try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { /* memory only */ }
  // Erase an old plaintext PAT left by earlier versions.
  try { localStorage.removeItem('blog-gh-token'); } catch (e) { /* storage unavailable */ }
  function clear() {
    token = '';
    try { sessionStorage.removeItem(KEY); } catch (e) { /* memory only */ }
  }
  function get() { return token; }
  async function validate(value) {
    window.BlogAuth.requireAdmin();
    var cfg = window.BlogConfig;
    var headers = { Authorization: 'Bearer ' + value, Accept: 'application/vnd.github+json' };
    var who = await fetch('https://api.github.com/user', { headers: headers });
    if (!who.ok) throw new Error('GitHub /user 验证失败：' + who.status);
    var repo = await fetch('https://api.github.com/repos/' + encodeURIComponent(cfg.GITHUB_OWNER) + '/' + encodeURIComponent(cfg.GITHUB_REPO), { headers: headers });
    if (!repo.ok) throw new Error('无法访问目标仓库：' + repo.status);
    var info = await repo.json();
    if (!info.permissions || !info.permissions.push) throw new Error('PAT 没有目标仓库的写入权限。');
    return who.json();
  }
  async function connect(value, rememberSession) {
    if (!value) throw new Error('请输入 PAT。');
    await validate(value);
    token = value;
    if (rememberSession !== false) {
      try { sessionStorage.setItem(KEY, value); } catch (e) { /* memory only */ }
    }
  }
  document.addEventListener('blog-auth-change', function () { if (!window.BlogAuth.user()) clear(); });
  window.GitHubCredentials = { get: get, clear: clear, connect: connect, validate: validate };
})();
