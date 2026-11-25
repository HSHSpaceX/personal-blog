/* 草稿暂存：把编辑中的内容留在本机，离开页面后回来还在。
 * 只写 localStorage，不发网络请求，不存敏感内容（不含 token / 私信）。
 * 统一命名空间 blog-draft:v1:<scope>，14 天自动过期。 */
(function (root) {
  'use strict';

  var PREFIX = 'blog-draft:v1:';
  var TTL = 1000 * 60 * 60 * 24 * 14;
  var MAX_LENGTH = 400 * 1024;

  function available() {
    try {
      root.localStorage.setItem(PREFIX + 'probe', '1');
      root.localStorage.removeItem(PREFIX + 'probe');
      return true;
    } catch (error) {
      return false;
    }
  }

  function scope() {
    var parts = [];
    for (var index = 0; index < arguments.length; index++) {
      var part = arguments[index];
      if (part !== undefined && part !== null && String(part) !== '') parts.push(String(part));
    }
    return parts.join(':');
  }

  function save(key, payload) {
    if (!available() || !key) return false;
    try {
      var text = JSON.stringify({ v: 1, savedAt: Date.now(), payload: payload });
      if (text.length > MAX_LENGTH) return false;
      root.localStorage.setItem(PREFIX + key, text);
      return true;
    } catch (error) {
      return false;
    }
  }

  /* 返回 { savedAt, payload } 或 null；过期自动清理。 */
  function load(key) {
    if (!available() || !key) return null;
    try {
      var raw = root.localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      var record = JSON.parse(raw);
      if (!record || record.v !== 1 || !record.savedAt) {
        root.localStorage.removeItem(PREFIX + key);
        return null;
      }
      if (Date.now() - record.savedAt > TTL) {
        root.localStorage.removeItem(PREFIX + key);
        return null;
      }
      return record;
    } catch (error) {
      return null;
    }
  }

  function clear(key) {
    if (!key) return;
    try { root.localStorage.removeItem(PREFIX + key); } catch (error) { /* 忽略隐私模式限制 */ }
  }

  function clearExpired() {
    if (!available()) return;
    try {
      var stale = [];
      for (var index = 0; index < root.localStorage.length; index++) {
        var name = root.localStorage.key(index);
        if (!name || name.indexOf(PREFIX) !== 0) continue;
        var record = null;
        try { record = JSON.parse(root.localStorage.getItem(name)); } catch (error) { record = null; }
        if (!record || !record.savedAt || Date.now() - record.savedAt > TTL) stale.push(name);
      }
      stale.forEach(function (name) { root.localStorage.removeItem(name); });
    } catch (error) { /* 忽略 */ }
  }

  /* 防抖：编辑器每次按键都存会很吵，攒 600ms 再写一次。 */
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, wait || 600);
    };
  }

  function describe(record) {
    if (!record || !record.savedAt) return '';
    var date = new Date(record.savedAt);
    var pad = function (value) { return String(value).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  var api = {
    available: available,
    scope: scope,
    save: save,
    load: load,
    clear: clear,
    clearExpired: clearExpired,
    debounce: debounce,
    describe: describe,
    TTL: TTL
  };

  root.DraftStore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
