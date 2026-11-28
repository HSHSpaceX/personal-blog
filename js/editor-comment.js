/* 评论输入框的 Vditor 封装：把 <textarea> 换成 Vditor，
 * 但始终把 Markdown 同步回原 textarea，所以提交/校验逻辑完全不用改。 */
(function (root) {
  'use strict';

  var IMAGE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>';

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'classic';
  }

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

    function sync() {
      if (!vditor) return;
      textarea.value = vditor.getValue();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function insertImage(image) {
      if (!vditor || !image || !image.url) return;
      var alt = String(image.name || '图片').replace(/[\[\]()\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '图片';
      var markdown = '![' + alt + '](' + image.url + ')';
      try {
        if (typeof vditor.insertValue === 'function') vditor.insertValue('\n' + markdown + '\n');
        else vditor.setValue(String(vditor.getValue() || '').replace(/\s*$/, '') + '\n\n' + markdown + '\n', true);
      } catch (error) {
        try { vditor.setValue(String(vditor.getValue() || '') + '\n\n' + markdown + '\n', true); } catch (ignore) { /* 忽略 */ }
      }
      try { vditor.focus(); } catch (error) { /* 忽略 */ }
      sync();
    }

    function openPicker() {
      if (!root.CommentAssetPicker) {
        if (root.alert) root.alert('图片选择器未加载，请刷新页面后重试。');
        return;
      }
      try {
        root.CommentAssetPicker.open({ onSelect: insertImage });
      } catch (error) {
        if (root.alert) root.alert('无法打开资源中心：' + (error.message || error));
      }
    }

    /* 外部脚本常直接给 textarea 赋值（例如清空草稿），这里转发给编辑器。 */
    try {
      var proto = Object.getPrototypeOf(textarea);
      var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        Object.defineProperty(textarea, 'value', {
          configurable: true,
          get: function () { return descriptor.get.call(this); },
          set: function (next) {
            descriptor.set.call(this, next);
            if (vditor && next !== vditor.getValue()) { try { vditor.setValue(next || '', true); } catch (error) { /* 忽略 */ } }
          }
        });
      }
    } catch (error) { /* 忽略 */ }

    root.EditorEngine.load().then(function (Vditor) {
      vditor = new Vditor(mount, {
        height: opts.height || 160,
        mode: 'ir',
        value: textarea.value || '',
        lang: 'zh_CN',
        icon: 'ant',
        theme: currentTheme(),
        cdn: root.EditorEngine.CDN,
        cache: { enable: false },
        placeholder: opts.placeholder || '写下你的想法…',
        toolbarConfig: { pin: false },
        toolbar: [
          'bold', 'italic', 'strike', '|',
          'inline-code', 'code', 'link', '|',
          'list', 'quote', '|',
          { name: 'comment-image', tip: '插入图片', tipPosition: 's', icon: IMAGE_ICON, click: function () { openPicker(); } },
          '|', 'undo', 'redo'
        ],
        input: sync,
        after: function () {
          if (vditor) textarea.value = vditor.getValue();
        }
      });
      document.addEventListener('blog-theme-change', function (event) {
        if (!vditor || typeof vditor.setTheme !== 'function') return;
        try {
          var next = event.detail && event.detail.theme === 'dark' ? 'dark' : 'classic';
          vditor.setTheme(next, next === 'dark' ? 'dark' : 'light', '');
        } catch (error) { /* 忽略 */ }
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

  /* 页面自带的评论框：文章页 / 首页 / 关于页 / 账号中心。
   * 动态与图册的「发布正文」属于另一套编辑器，不在此处增强。 */
  function autoEnhance() {
    ['commentContent', 'accountCommentText'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.dataset.vditorComment && el.offsetParent !== null) {
        enhance(el, { placeholder: id === 'commentContent' ? '写下评论，支持 Markdown 与图片…' : '修改后的评论内容' });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoEnhance);
  else autoEnhance();
  /* 评论框常常在登录/数据就绪后才显示，补几次重试。 */
  document.addEventListener('blog-auth-change', function () { setTimeout(autoEnhance, 300); });
  [600, 1500, 3000].forEach(function (delay) { setTimeout(autoEnhance, delay); });
})(typeof window === 'object' ? window : globalThis);
