/* 资源中心卡片的磨砂玻璃 + 光标跟随光斑。
 *
 * 通过事件委托挂在文档上，所有 .rm-item（无论来自 account.html 的资源中心、
 * 评论选图对话框、动态/图册发布器）共享同一套光斑行为：
 *   - mousemove：把光标相对卡片的位置写成 CSS 变量 --rm-x / --rm-y；
 *   - mouseenter：显示光斑（--rm-glow-opacity: 1）；
 *   - mouseleave：光斑淡出（--rm-glow-opacity: 0），卡片平滑复原。
 * 光斑元素 .rm-glow 在首次遇到卡片时注入一次，避免重复。 */
(function (root) {
  'use strict';

  var GLOW_CLASS = 'rm-glow';

  function ensureGlow(card) {
    if (card.querySelector('.' + GLOW_CLASS)) return;
    var glow = document.createElement('div');
    glow.className = GLOW_CLASS;
    glow.setAttribute('aria-hidden', 'true');
    card.appendChild(glow);
  }

  function setGlow(card, event) {
    var rect = card.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    card.style.setProperty('--rm-x', x + 'px');
    card.style.setProperty('--rm-y', y + 'px');
  }

  function resetGlow(card) {
    /* 光斑位置保留，只让 CSS transition 把 opacity 淡回 0；
       下次 mouseenter 时再点亮，避免跳变。 */
    card.style.removeProperty('--rm-glow-opacity');
  }

  function handleEnter(event) {
    var card = event.target.closest ? event.target.closest('.rm-item') : null;
    if (!card || !card.contains) return;
    ensureGlow(card);
    card.style.setProperty('--rm-glow-opacity', '1');
    setGlow(card, event);
  }

  function handleMove(event) {
    var card = event.target.closest ? event.target.closest('.rm-item') : null;
    if (!card) return;
    setGlow(card, event);
  }

  function handleLeave(event) {
    var card = event.target.closest ? event.target.closest('.rm-item') : null;
    if (!card) return;
    /* 只有真正离开卡片（而非进入子元素）时淡出。 */
    if (card.contains(event.relatedTarget)) return;
    card.style.removeProperty('--rm-glow-opacity');
  }

  function bind() {
    document.addEventListener('mouseover', handleEnter);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseout', handleLeave);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  root.RmGlow = { bind: bind, ensureGlow: ensureGlow };
})(typeof window === 'object' ? window : globalThis);
