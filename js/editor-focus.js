/* 专注编辑页：account.html?editor=article|moment|album
 * 只保留站点栏、返回账号中心和编辑器，其余面板全部隐藏并自动新建草稿。 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var type = params.get('editor');
  if (!type) return;
  if (['article', 'moment', 'album'].indexOf(type) < 0) return;

  var LABELS = { article: '新建文章', moment: '新建动态', album: '新建图册' };

  document.documentElement.classList.add('editor-focus');

  function buildBar() {
    var editor = document.getElementById('communityEditor');
    if (!editor || !editor.parentNode) return null;
    if (document.querySelector('.editor-focus-bar')) return document.querySelector('.editor-focus-bar');

    var bar = document.createElement('div');
    bar.className = 'editor-focus-bar';

    var back = document.createElement('a');
    back.className = 'editor-focus-back';
    back.href = 'account.html';
    back.rel = 'nofollow';
    back.textContent = '← 返回账号中心';

    var label = document.createElement('span');
    label.className = 'editor-focus-label';
    label.textContent = LABELS[type] || '编辑器';

    bar.appendChild(back);
    bar.appendChild(label);
    editor.parentNode.insertBefore(bar, editor);
    return bar;
  }

  var revision = params.get('revision');

  function boot() {
    var bar = buildBar();
    /* 带 revision 时由 community-ui 的深链逻辑打开该版本，这里只补返回条。 */
    if (revision) {
      if (!bar) return false;
      var link = document.createElement('a');
      link.className = 'editor-focus-popout';
      link.href = 'account.html?editor=' + encodeURIComponent(type) + '&revision=' + encodeURIComponent(revision);
      link.target = '_blank';
      link.rel = 'nofollow';
      link.textContent = '在新标签页打开';
      if (!bar.querySelector('.editor-focus-popout')) bar.appendChild(link);
      return true;
    }
    if (window.CommunityEditorUI && typeof window.CommunityEditorUI.openNew === 'function') {
      window.CommunityEditorUI.openNew(type);
      return true;
    }
    return false;
  }

  /* community-ui 依赖登录态，可能晚于本脚本就绪，最多等 10 秒。 */
  if (!boot()) {
    var tries = 0;
    var timer = setInterval(function () {
      if (boot() || ++tries > 40) clearInterval(timer);
    }, 250);
  }

  /* 专注页里标题栏改为返回按钮的标题。 */
  document.title = (LABELS[type] || '编辑') + ' - 拾光手记';
})();
