/* 评论输入框的 Vditor 封装：把 <textarea> 换成 Vditor，
 * 但始终把纯文本同步回原 textarea，所以提交/校验逻辑完全不用改。 */
(function (root) {
  'use strict';

  function enhance(textarea, options) {
    if (!textarea || textarea.dataset.vditorComment) return null;
    if (root.__editorEngine === 'legacy') return null;
    if (!root.EditorEngine || !root.EditorEngine.use || !root.EditorEngine.use()) return null;

    var opts = options || {};
    var mount = document.createElement('div');
    mount.className = 'vditor-mount vditor-comment';
    textarea.parentNode.insertBefore(mount, textarea.nextSibling);
    textarea.hidden = true;
    textarea.dataset.vditorComment = '1';

    var vditor = null;
    root.EditorEngine.load().then(function (Vditor) {
      vditor = new Vditor(mount, {
        height: opts.height || 180,
        mode: 'ir',
        value: textarea.value || '',
        lang: 'zh_CN',
        icon: 'ant',
        cdn: root.EditorEngine.CDN,
        cache: { enable: false },
        placeholder: opts.placeholder || '写下你的想法…',
        toolbarConfig: { pin: false, exclude: ['upload', 'record', 'fullscreen', 'outline', 'devtools', 'info', 'help', 'both', 'preview', 'headings', 'ordered-list', 'check', 'undo', 'redo', 'emoji', 'insert-before', 'insert-after'] },
        input: function () {
          /* 保持 textarea 与编辑器同步：外部脚本、提交逻辑照旧读 .value */
          textarea.value = vditor.getValue().replace(/\n{3,}/g, '\n\n').trim();
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        },
        after: function () {
          textarea.value = vditor.getValue();
        }
      });
    }).catch(function () {
      /* 加载失败：恢复原来的 textarea，不影响评论。 */
      textarea.hidden = false;
      mount.remove();
      delete textarea.dataset.vditorComment;
    });

    return {
      setValue: function (value) {
        textarea.value = value || '';
        if (vditor) vditor.setValue(value || '', true);
      },
      getValue: function () { return textarea.value; },
      focus: function () { if (vditor) vditor.focus(); }
    };
  }

  function enhanceById(id, options) {
    var el = document.getElementById(id);
    return el ? enhance(el, options) : null;
  }

  root.CommentEditor = { enhance: enhance, enhanceById: enhanceById };

  /* 页面自带的评论框：文章页 / 首页 / 关于页 */
  function autoEnhance() {
    ['commentContent', 'accountCommentText'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.dataset.vditorComment && el.offsetParent !== null) {
        enhance(el, { placeholder: id === 'commentContent' ? '写下评论…' : '修改后的评论内容' });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoEnhance);
  else autoEnhance();
  /* 评论框常常在登录/数据就绪后才显示，补几次重试。 */
  document.addEventListener('blog-auth-change', function () { setTimeout(autoEnhance, 300); });
  [600, 1500, 3000].forEach(function (delay) { setTimeout(autoEnhance, delay); });
})(typeof window === 'object' ? window : globalThis);
