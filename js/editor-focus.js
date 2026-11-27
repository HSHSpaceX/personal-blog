/* 专注编辑布局：在独立标签页中只留站点栏 + 返回 + 编辑器。
 * 由 community-ui 在关闭编辑器时调用 exit()。
 * 也支持直接访问 account.html?editor=article 时自动进入。 */
(function (root) {
  'use strict';

  var LABELS = { article: '新建文章', moment: '新建动态', album: '新建图册' };
  var current = null;
  var exited = false;

  function bar() {
    return document.querySelector('.editor-focus-bar');
  }

  function buildBar(type) {
    var editor = document.getElementById('communityEditor');
    if (!editor || !editor.parentNode) return null;
    var existing = bar();
    if (existing) return existing;

    var wrap = document.createElement('div');
    wrap.className = 'editor-focus-bar';

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'editor-focus-back';
    back.textContent = '← 返回账号中心';
    back.addEventListener('click', function () {
      /* 直接在当前页退出专注模式，避免整页重新加载。 */
      var close = document.getElementById('communityCloseEditor') || document.getElementById('communityReturn');
      if (close) close.click();
      exit();
    });

    var label = document.createElement('span');
    label.className = 'editor-focus-label';
    label.textContent = LABELS[type] || '编辑';

    wrap.appendChild(back);
    wrap.appendChild(label);
    editor.parentNode.insertBefore(wrap, editor);
    return wrap;
  }

  function enter(type) {
    if (!type) return;
    current = type;
    exited = false;
    document.documentElement.classList.add('editor-focus');
    buildBar(type);
    var label = bar() && bar().querySelector('.editor-focus-label');
    if (label) label.textContent = LABELS[type] || '编辑';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function exit() {
    current = null;
    exited = true;
    document.documentElement.classList.remove('editor-focus');
    var wrap = bar();
    if (wrap) wrap.remove();
    /* 去掉 URL 上的 editor 参数，避免下次回来又被直接拉进编辑页。 */
    try { sessionStorage.removeItem('blog-editor-target'); } catch (error) { /* 忽略 */ }
    try {
      var url = new URL(location.href);
      if (url.searchParams.has('editor')) {
        url.searchParams.delete('editor');
        url.hash = '#articles';
        history.replaceState(history.state, '', url.href);
      }
    } catch (error) { /* 忽略 */ }
  }

  root.EditorFocus = { enter: enter, exit: exit, active: function () { return !!current; } };

  /* 直接访问 ?editor=<type>：进入专注布局并自动新建。 */
  var params = new URLSearchParams(location.search);
  var type = params.get('editor');
  if (type && LABELS[type]) {
    document.documentElement.classList.add('editor-focus');
    document.title = (LABELS[type] || '编辑') + ' - 拾光手记';
    var revision = params.get('revision');
    /* 不管有没有版本号，都主动把编辑器打开一遍；页面自身的刷新会覆盖视图，
       所以只在编辑器确实被隐藏时重试，避免清掉正在输入的内容。 */
    var attempts = 0;
    function openTarget() {
      if (exited) return;
      var api = root.CommunityEditorUI;
      if (!api) { if (++attempts < 60) setTimeout(openTarget, 250); return; }
      var editorEl = document.getElementById('communityEditor');
      if (editorEl && !editorEl.hidden) return;
      try {
        if (revision && typeof api.openDraft === 'function') api.openDraft(revision);
        else if (revision && typeof api.openEdit === 'function') api.openEdit(revision);
        else if (typeof api.openNew === 'function') api.openNew(type);
      } catch (error) { /* 下一轮重试 */ }
      setTimeout(function () {
        var again = document.getElementById('communityEditor');
        if (again && again.hidden && attempts < 10) { attempts++; openTarget(); return; }
        if (again && again.hidden && attempts >= 10) {
          var wrap = document.querySelector('.editor-focus-bar');
          if (wrap && !wrap.querySelector('.editor-focus-error')) {
            var tip = document.createElement('span');
            tip.className = 'editor-focus-error';
            tip.textContent = '无法打开这份草稿，请返回账号中心重试。';
            wrap.appendChild(tip);
          }
        }
      }, 1200);
    }
    openTarget();
    document.addEventListener('blog-auth-change', function () { setTimeout(openTarget, 400); });
    document.addEventListener('posts-ready', function () { setTimeout(openTarget, 400); });
  }
})(typeof window === 'object' ? window : globalThis);
