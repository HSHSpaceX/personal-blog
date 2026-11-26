/* 专注编辑布局：打开编辑器时只留站点栏 + 返回 + 编辑器，不再另开页面。
 * 由 community-ui 在打开/关闭编辑器时调用 enter()/exit()。
 * 也支持直接访问 account.html?editor=article 时自动进入。 */
(function (root) {
  'use strict';

  var LABELS = { article: '新建文章', moment: '新建动态', album: '新建图册' };
  var current = null;

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
    document.documentElement.classList.add('editor-focus');
    buildBar(type);
    var label = bar() && bar().querySelector('.editor-focus-label');
    if (label) label.textContent = LABELS[type] || '编辑';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function exit() {
    current = null;
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
    if (!revision) {
      /* 打开草稿必须等页面自身刷新完毕，否则 refresh() 会把编辑器重新隐藏。
         做法：多次尝试，且只在编辑器确实被隐藏时才重试，避免覆盖正在输入的内容。 */
      var attempts = 0;
      function savedTarget() {
        try {
          var raw = sessionStorage.getItem('blog-editor-target');
          if (!raw) return null;
          var target = JSON.parse(raw);
          return target && target.type === type && target.revisionId ? target : null;
        } catch (error) { return null; }
      }
      function openDraft() {
        var api = root.CommunityEditorUI;
        var editorEl = document.getElementById('communityEditor');
        if (editorEl && !editorEl.hidden) return;              // 已经在编辑器里
        if (!api || typeof api.openNew !== 'function') {
          if (++attempts < 60) setTimeout(openDraft, 250);
          return;
        }
        var target = savedTarget();
        var opened = false;
        if (target && typeof api.openEdit === 'function') {
          /* 先尝试恢复上次编辑的同一草稿；失败（已提交/无权限）就新建，保证留在编辑器里。 */
          try { api.openEdit(target.revisionId); opened = true; } catch (error) { opened = false; }
        }
        if (!opened) api.openNew(type);
        setTimeout(function () {
          var again = document.getElementById('communityEditor');
          /* 恢复失败时不会再触发重试逻辑，这里兜底新建一次。 */
          if (again && again.hidden && target && typeof api.openNew === 'function' && !opened) api.openNew(type);
          if (again && again.hidden && attempts < 8) { attempts++; openDraft(); }
        }, 1500);
      }
      openDraft();
      document.addEventListener('blog-auth-change', function () { setTimeout(openDraft, 400); });
      document.addEventListener('posts-ready', function () { setTimeout(openDraft, 400); });
    }
  }
})(typeof window === 'object' ? window : globalThis);
