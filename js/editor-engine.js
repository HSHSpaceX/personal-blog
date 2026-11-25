/* 编辑器引擎开关：在「现有编辑器」和 Vditor 之间切换。
 * 默认 legacy —— 现有浏览器回归测试依赖 #communityRichEditor 可编辑，
 * 只有用户在本机主动切换后才会加载 Vditor（约 300KB + 3.8MB 引擎，按需加载）。 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'blog-editor-engine';
  var CDN = 'https://unpkg.com/vditor@3.11.0';
  var loading = null;

  function stored() {
    try { return root.localStorage.getItem(STORAGE_KEY); } catch (error) { return null; }
  }

  function mode() {
    return stored() === 'vditor' ? 'vditor' : 'legacy';
  }

  function set(next) {
    try { root.localStorage.setItem(STORAGE_KEY, next === 'vditor' ? 'vditor' : 'legacy'); } catch (error) { /* 忽略 */ }
  }

  /* 当前是否应当使用 Vditor：需要用户已切换，且环境具备 fetch/Promise。 */
  function use() {
    return mode() === 'vditor' && typeof root.fetch === 'function' && typeof root.Promise === 'function';
  }

  function injectCss(href) {
    if (document.querySelector('link[data-vditor-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-vditor-css', '1');
    document.head.appendChild(link);
  }

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('Vditor 加载失败')); };
      document.head.appendChild(script);
    });
  }

  /* 加载 Vditor；失败时上层回退到现有编辑器，不阻塞写作。 */
  function load() {
    if (loading) return loading;
    if (typeof root.Vditor === 'function') return Promise.resolve(root.Vditor);
    injectCss(CDN + '/dist/index.css');
    loading = injectScript(CDN + '/dist/index.min.js').then(function () {
      if (typeof root.Vditor !== 'function') throw new Error('Vditor 未就绪');
      return root.Vditor;
    }).catch(function (error) {
      loading = null;
      throw error;
    });
    return loading;
  }

  /* 让 CSS 知道当前引擎，用于隐藏旧编辑器的遗留界面。 */
  function markEngine() {
    try { document.documentElement.classList.toggle('editor-vditor', mode() === 'vditor'); } catch (error) { /* 忽略 */ }
  }
  markEngine();

  /* 账号中心里的开关：勾选后刷新页面即换用 Vditor。 */
  function bindToggle() {
    var box = document.getElementById('editorEngineToggle');
    if (!box) return;
    box.checked = mode() === 'vditor';
    box.addEventListener('change', function () {
      set(box.checked ? 'vditor' : 'legacy');
      root.location.reload();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else bindToggle();

  var api = { mode: mode, set: set, use: use, load: load, CDN: CDN };
  root.EditorEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
