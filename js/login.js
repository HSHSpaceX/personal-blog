(function () {
  'use strict';

  var USER_HASH = '32d816bfe8b14ea8fd6d12314183f648c54136f8a344506f50dcc63f772f035a';
  var PASS_HASH = '8fe5479a3dd10ee6932d5b3cd0530481dbf35d0241641176aca9bf1b6b05f1d9';
  var AUTH_KEY = 'blog-auth';

  try {
    if (sessionStorage.getItem(AUTH_KEY) === '1') {
      window.location.replace('admin.html');
      return;
    }
  } catch (e) {
    /* 忽略 */
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, kind) {
    var el = $('loginStatus');
    el.textContent = message;
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  async function sha256Hex(value) {
    var bytes = new TextEncoder().encode(value);
    var digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  async function attemptLogin() {
    var username = $('username').value.trim();
    var password = $('password').value;
    if (!username || !password) {
      setStatus('请输入账号和密码。', 'err');
      return;
    }
    setStatus('正在验证…');
    try {
      var userOk = (await sha256Hex(username)) === USER_HASH;
      var passOk = (await sha256Hex(password)) === PASS_HASH;
      if (!userOk || !passOk) {
        setStatus('账号或密码不正确。', 'err');
        return;
      }
      try {
        sessionStorage.setItem(AUTH_KEY, '1');
      } catch (e) {
        /* 忽略 */
      }
      window.location.href = 'admin.html';
    } catch (e) {
      setStatus('验证失败，请通过 HTTPS 访问本页。', 'err');
    }
  }

  $('loginBtn').addEventListener('click', attemptLogin);
  $('password').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') attemptLogin();
  });
  $('username').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') attemptLogin();
  });
})();
