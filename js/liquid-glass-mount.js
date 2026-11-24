/* Liquid Glass 全站挂载脚本:把 css/liquid-glass.css 里所有玻璃材质元素挂上折射引擎 */
(function () {
  "use strict";

  // 折射档位:按元素类型分配,数值 = 峰值边缘位移(px)
  var LEVELS = {
    card: 40,   // 大内容卡片
    input: 12,  // 输入框/下拉
    btn: 16,    // 按钮/图标按钮
    nav: 20,    // 导航/页头
    chip: 10    // 小芯片/标签
  };

  // 每个元素匹配到哪个档位(顺序敏感,先匹配先得)
  var RULES = [
    function (el, c) {
      if (c.nav) return "nav";
      if (c.chip) return "chip";
      if (c.input) return "input";
      if (c.btn) return "btn";
      if (c.card) return "card";
      return null;
    }
  ];

  function classes(el) {
    var s = new Set((el.className || "").toString().split(/\s+/));
    var list = el.classList;
    for (var i = 0; i < list.length; i++) s.add(list[i]);
    // 常见元素语义
    if (el.tagName === "BUTTON") s.add("btn");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") s.add("input");
    return s;
  }

  // 从 css/liquid-glass.css 提炼出的玻璃元素选择器
  var SELECTORS = [
    // 页头 / 导航
    ".site-header", ".site-nav", ".header-actions", ".user-menu",
    // 卡片
    ".post-card", ".featured-card", ".rail-card", ".moment-card",
    ".album-card", ".aside-card", ".home-comment-card", ".content-card",
    ".profile-card", ".public-user-card", ".public-content-card",
    ".glass-card", ".narrow-card", ".auth-card", ".login-card",
    ".admin-card", ".dm-thread", ".dm-chat", ".dm-message",
    ".msg-item", ".archive-row", ".timeline-item",
    // 对话框 / 模态
    ".compose-dialog", ".removal-dialog", ".rm-modal", ".gallery-modal",
    ".lightbox-dialog", ".album-page-composer",
    // 按钮
    ".btn", ".btn-login", ".icon-btn", ".comment-reply-btn",
    ".comment-reply-cancel", ".like-btn", ".moment-action-btn",
    ".moment-edit-btn", ".moment-delete", ".code-copy-btn",
    ".gallery-plus", ".arrow-link", ".contrib-link", ".back-band .text-link",
    ".filter-chip", ".category-chip",
    // 输入
    ".search-box", ".field input", ".field select", ".field textarea",
    ".comment-form input", ".comment-form textarea",
    ".moment-comment-form textarea", ".dm-chat input",
    ".comment-submit", ".message-tabs .btn"
  ];

  var MOUNTED = new WeakSet();

  function mountAll() {
    var els = document.querySelectorAll(SELECTORS.join(","));
    els.forEach(function (el) {
      if (MOUNTED.has(el)) return;
      if (el.closest(".liquid-glass")) return; // 已在玻璃内
      var c = classes(el);
      var level = null;
      for (var i = 0; i < RULES.length && !level; i++) {
        var r = RULES[i](el, c);
        if (r) level = r;
      }
      if (!level) level = "card";
      el.classList.add("liquid-glass");
      el.setAttribute("data-liquid-glass", "");
      el.setAttribute("data-lg-refraction", String(LEVELS[level]));
      el.setAttribute("data-lg-aberration", level === "card" ? "2" : "1");
      if (c.btn || c.nav) el.setAttribute("data-lg-interactive", "");
      MOUNTED.add(el);
    });
    if (window.LiquidGlass) window.LiquidGlass.mountAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }

  // 动态内容(SPA 路由/评论/卡片)挂载后补挂
  var observer = new MutationObserver(function () {
    mountAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
