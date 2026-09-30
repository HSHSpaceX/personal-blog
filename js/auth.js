(function () {
  'use strict';
  var config = window.BlogConfig || {};
  var client = null;
  var user = null;
  var role = 'guest';
  var loading = null;
  var incomingAuthType = new URLSearchParams(location.hash.slice(1)).get('type');
  try { localStorage.removeItem('blog-auth'); } catch (e) { /* old local-only login */ }
  function configured() { return !!(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY); }
  function notify() { document.dispatchEvent(new CustomEvent('blog-auth-change', { detail: { user: user, role: role } })); }
  function check(result) { if (result.error) throw result.error; return result.data; }
  function requireClient() { if (!client) throw new Error('Supabase 尚未配置或 SDK 不可用。'); return client; }
  function requireUser() { if (!user) throw new Error('请先登录。'); return user; }
  async function refresh() {
    if (!client) { user = null; role = 'guest'; notify(); return; }
    user = check(await client.auth.getUser()).user;
    role = 'guest';
    if (user) {
      var row = await client.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      if (!row.error && row.data) role = row.data.role;
      else role = 'user';
    }
    notify();
  }
  function ready() {
    if (loading) return loading;
    loading = (async function () {
      if (!configured()) { notify(); return null; }
      if (!/^https:\/\//.test(config.SUPABASE_URL)) throw new Error('Supabase URL 必须使用 HTTPS。');
      if (!window.supabase) {
        await new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.10/dist/umd/supabase.js';
          script.onload = resolve;
          script.onerror = function () { reject(new Error('Supabase SDK 加载失败。')); };
          document.head.appendChild(script);
        });
      }
      client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange(function () { setTimeout(function () { refresh().catch(function () { user = null; role = 'guest'; notify(); }); }, 0); });
      await refresh();
      if ((incomingAuthType === 'invite' || incomingAuthType === 'recovery') &&
          !new URLSearchParams(location.search).has('reset')) {
        location.replace(new URL('login.html?reset=1', config.SITE_BASE_URL).href);
      }
      return client;
    })().catch(function (error) { loading = null; user = null; role = 'guest'; notify(); throw error; });
    return loading;
  }
  window.BlogAuth = {
    ready: ready, configured: configured, client: requireClient, user: function () { return user; },
    role: function () { return role; }, isAdmin: function () { return !!user && role === 'admin'; },
    requireUser: requireUser,
    requireAdmin: function () { requireUser(); if (role !== 'admin') throw new Error('仅管理员可执行此操作。'); },
    signIn: async function (email, password) { await ready(); check(await requireClient().auth.signInWithPassword({ email: email, password: password })); await refresh(); },
    signOut: async function () { if (client) check(await client.auth.signOut()); user = null; role = 'guest'; notify(); },
    resetPassword: async function (email) { await ready(); check(await requireClient().auth.resetPasswordForEmail(email, { redirectTo: new URL('login.html?reset=1', config.SITE_BASE_URL).href })); },
    updatePassword: async function (password) { await ready(); check(await requireClient().auth.updateUser({ password: password })); }
  };
  ready().catch(function (error) { console.warn('Auth unavailable:', error.message); });
})();
