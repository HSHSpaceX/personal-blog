/* 评论 Markdown 渲染器：支持段落、加粗、斜体、行内代码、链接、图片、代码块、列表。
 * 图片必须是本站资源中心签名地址或 data URI，否则降级为链接。
 * 纯函数，无 DOM 依赖，可在 jsdom 和浏览器中运行。 */
(function (root) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ESC[ch]; }); }

  /* 判断一个 src 是否安全可渲染为 <img>：
   * 资源中心地址（含签名/公开两种形式）、本站资源、https 外链；
   * data URI 只允许常见的位图 base64，避免 SVG 里的脚本/外链。 */
  function safeImageSrc(src, baseURI) {
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(src)) return true;
    try {
      var u = new URL(src, baseURI || (typeof location !== 'undefined' ? location.href : 'https://localhost'));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      /* 资源中心（签名/公开）或本站相对路径 */
      if (/\/storage\/v1\/object\//.test(u.pathname)) return true;
      if (u.protocol === 'https:') return true;
      /* 本地开发：localhost / 127.0.0.1 / ::1 允许 http。 */
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') return true;
      if (u.origin === (typeof location !== 'undefined' ? location.origin : 'https://localhost')) return true;
    } catch (e) { /* 无法解析，不允许 */ }
    return false;
  }

  /* 单行行内 Markdown → HTML。
   * 第一步：把 Markdown 语法（图片、链接）替换成带索引的占位符，
   * 同时把 alt / href / label 单独收集；剩余纯文本统一 esc()。
   * 第二步：把占位符展开成受控的 <img> / <a>，alt 来自已 esc 的收集值，
   * src / href 通过 unescapeSrc 还原到原始 URL 做协议判断，
   * 避免 &amp; / &lt; / &gt; 还原后绕过白名单。 */
  function unescapeSrc(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  function inline(text, baseURI) {
    var out = String(text);
    var images = [];
    var links = [];
    /* 图片 */
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (_, alt, src) {
      var id = String(images.length);
      images.push({ alt: alt, src: src });
      return '\u0001IMG' + id + '\u0002';
    });
    /* 链接 */
    out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var id = String(links.length);
      links.push({ label: label, href: href });
      return '\u0001LNK' + id + '\u0002';
    });
    /* 其余纯文本统一转义 */
    out = esc(out);
    /* 加粗 */
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    /* 斜体 */
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    /* 行内代码 */
    out = out.replace(/`([^`]+)`/g, function (_, code) { return '<code>' + code + '</code>'; });
    /* 图片占位符 */
    out = out.replace(/\u0001IMG(\d+)\u0002/g, function (_, idx) {
      var item = images[Number(idx)];
      if (!item) return '';
      var s = unescapeSrc(item.src);
      var altEsc = esc(item.alt);
      if (!safeImageSrc(s, baseURI)) return altEsc || esc('图片');
      return '<img src="' + s + '" alt="' + altEsc + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
    });
    /* 链接占位符 */
    out = out.replace(/\u0001LNK(\d+)\u0002/g, function (_, idx) {
      var item = links[Number(idx)];
      if (!item) return '';
      var h = unescapeSrc(item.href);
      var labelEsc = esc(item.label);
      if (!/^(https?:\/\/|mailto:)/i.test(h)) return labelEsc;
      return '<a href="' + h + '" rel="noopener noreferrer nofollow" target="_blank">' + labelEsc + '</a>';
    });
    return out;
  }

  /* Markdown → HTML（段落感知，列表用 <p> 前缀，不引入 <ul>/<li>） */
  function render(markdown, baseURI) {
    var lines = String(markdown || '').split('\n');
    var out = [], inCode = false, codeBuf = [];
    function flushParagraph(text) {
      if (text.trim()) out.push('<p>' + inline(text, baseURI) + '</p>');
    }
    var para = [];
    lines.forEach(function (line) {
      if (/^```/.test(line)) {
        if (inCode) {
          out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = []; inCode = false;
        } else { inCode = true; }
        return;
      }
      if (inCode) { codeBuf.push(line); return; }
      /* 列表项 */
      var liMatch = line.match(/^(\s*)[-*+]\s+(.+)$/) || line.match(/^(\s*)\d+\.\s+(.+)$/);
      if (liMatch) {
        if (para.length) { flushParagraph(para.join(' ')); para = []; }
        out.push('<p>' + esc(liMatch[1]) + '• ' + inline(liMatch[2], baseURI) + '</p>');
        return;
      }
      if (/^>\s?/.test(line)) {
        if (para.length) { flushParagraph(para.join(' ')); para = []; }
        out.push('<blockquote>' + inline(line.replace(/^>\s?/, ''), baseURI) + '</blockquote>');
        return;
      }
      if (line.trim() === '') {
        if (para.length) { flushParagraph(para.join(' ')); para = []; }
        return;
      }
      para.push(line);
    });
    if (para.length) flushParagraph(para.join(' '));
    if (inCode && codeBuf.length) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
    return out.join('\n');
  }

  /* 纯文本 → 简单 HTML（段落 + 换行，不做 Markdown 解析） */
  function renderPlain(text) {
    var paragraphs = String(text || '').split(/\n{2,}/).map(function (p) {
      var trimmed = p.replace(/\s+/g, ' ').trim();
      return trimmed ? '<p>' + esc(trimmed) + '</p>' : '';
    }).filter(Boolean);
    return paragraphs.join('\n');
  }

  /* 判断内容是否包含 Markdown 标记（决定用 render 还是 renderPlain） */
  function hasMarkdown(text) {
    return /[*_`>#!\[\]]|\n{2,}/.test(String(text || ''));
  }

  /* 构建评论 HTML：带 data-comment-html="1" 标记 */
  function buildHtml(text, baseURI) {
    var content = hasMarkdown(text) ? render(text, baseURI) : renderPlain(text);
    return '<div class="comment-html" data-comment-html="1">' + content + '</div>';
  }

  var api = { render: render, renderPlain: renderPlain, buildHtml: buildHtml, hasMarkdown: hasMarkdown, safeImageSrc: safeImageSrc, esc: esc, inline: inline };
  root.CommentMarkdown = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
