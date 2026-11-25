/* Vditor 适配层：对外暴露和 ContentEditor.create 完全一致的接口，
 * 内部用隐藏的旧编辑器做 HTML → 结构化 JSON 的转换，保证存储格式不变。
 *
 * 映射规则（schema 只接受这些块）：
 *   段落 / H2 / H3 / 引用 / 代码 / 有序·无序列表 / 资源块
 * 图片与附件仍走「资源管理」，正文里显示为可读的资源标记。 */
(function (root) {
  'use strict';

  var ASSET_TOKEN = /^\s*\[\[asset:([0-9a-f-]{36})\]\]\s*$/i;
  var ALLOWED = ['P', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'A', 'BR', 'SPAN'];

  /* Vditor 输出的 HTML 里有很多 schema 不认识的标签/属性，先净化成受控子集。 */
  function sanitize(html) {
    var parsed = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    function walk(node) {
      var out = '';
      Array.prototype.forEach.call(node.childNodes, function (child) {
        if (child.nodeType === 3) { out += String(child.nodeValue); return; }
        if (child.nodeType !== 1) return;
        var tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IMG' || tag === 'TABLE' || tag === 'HR' || tag === 'IFRAME') {
          if (tag === 'IMG') out += '<span></span>';
          return;
        }
        var mapped = tag;
        if (tag === 'H1') mapped = 'H2';
        else if (['H4', 'H5', 'H6'].includes(tag)) mapped = 'H3';
        else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') mapped = 'P';
        else if (tag === 'B') mapped = 'STRONG';
        else if (tag === 'I') mapped = 'EM';
        else if (tag === 'CODE') mapped = 'SPAN';
        else if (tag === 'PRE') {
          out += '<pre>' + String(child.textContent) + '</pre>';
          return;
        }
        if (ALLOWED.indexOf(mapped) < 0) { out += walk(child); return; }
        var attrs = '';
        if (mapped === 'A') {
          var href = child.getAttribute('href') || '';
          var label = (child.textContent || '').trim();
          /* 只保留文字正常、地址是 ASCII 的链接；粘贴产生的 [](中文句子) 一律丢弃。 */
          var okHref = /^(https?:\/\/|mailto:)[A-Za-z0-9._~:\/?#\[\]@!$&'()*+,;=%-]+$/i.test(href);
          if (!label || !okHref) { out += walk(child); return; }
          attrs = ' href="' + href.replace(/"/g, '&quot;') + '" rel="noopener noreferrer nofollow"';
        }
        out += '<' + mapped + attrs + '>' + walk(child) + '</' + mapped + '>';
      });
      return out;
    }
    return walk(parsed.body);
  }

  /* 结构化 JSON → Markdown（资源块转成占位标记）。 */
  function toMarkdown(document) {
    function runs(list) {
      return (list || []).map(function (run) {
        var text = String(run.text == null ? '' : run.text);
        var marks = run.marks || [];
        if (marks.indexOf('bold') >= 0) text = '**' + text + '**';
        if (marks.indexOf('italic') >= 0) text = '*' + text + '*';
        if (run.href) text = '[' + text + '](' + run.href + ')';
        return text;
      }).join('');
    }
    return (document.blocks || []).map(function (block) {
      if (block.type === 'asset') return '[[asset:' + block.asset_id + ']]';
      if (block.type === 'heading') return (block.level === 3 ? '### ' : '## ') + runs(block.runs);
      if (block.type === 'quote') return '> ' + runs(block.runs);
      if (block.type === 'code') return '```\n' + (block.runs || []).map(function (r) { return r.text; }).join('') + '\n```';
      if (block.type === 'list') {
        return (block.items || []).map(function (item, index) {
          return (block.ordered ? (index + 1) + '. ' : '- ') + runs(item);
        }).join('\n');
      }
      return runs(block.runs);
    }).join('\n\n');
  }

  function createVditor(options) {
    var host = options.editor;
    var toolbar = options.toolbar;
    var max = options.maxLength || 100000;
    var schema = root.CommunitySchema;

    /* 隐藏的旧编辑器只当 HTML → JSON 的转换器（不带 textarea，避免互相覆盖）。 */
    var converter = root.ContentEditor.create({
      editor: host,
      toolbar: toolbar,
      textarea: null,
      maxLength: max,
      onChange: function () {}
    });

    var mount = document.createElement('div');
    mount.className = 'vditor-mount';
    host.parentNode.insertBefore(mount, host.nextSibling);
    host.hidden = true;
    if (toolbar) toolbar.hidden = true;

    var vditor = null, ready = false, failed = false, queued = null;
    var lastDocument = { version: 1, blocks: [] };

    /* Markdown/HTML → 结构化 JSON；独占一段的资源标记升级为资源块。 */
    function readDocument() {
      if (!ready || !vditor) return lastDocument;
      var html;
      try { html = vditor.getHTML(); } catch (error) { return lastDocument; }
      try {
        host.innerHTML = sanitize(html);
        var document = converter.getDocument();
        var blocks = [];
        (document.blocks || []).forEach(function (block) {
          if (block.type === 'paragraph') {
            var text = (block.runs || []).map(function (r) { return r.text; }).join('');
            var match = ASSET_TOKEN.exec(text);
            if (match) { blocks.push({ type: 'asset', asset_id: match[1].toLowerCase() }); return; }
          }
          blocks.push(block);
        });
        lastDocument = { version: 1, blocks: blocks };
        return lastDocument;
      } catch (error) {
        /* 转换失败时保留上一次可用的文档，避免把正文清空。 */
        return lastDocument;
      }
    }

    function pushBody(body) {
      if (!ready || !vditor) return;
      var document = body && body.document ? body.document : null;
      if (!document) {
        vditor.setValue(String((body && (body.text || body.description)) || ''), true);
        lastDocument = { version: 1, blocks: [] };
        return;
      }
      lastDocument = document;
      vditor.setValue(toMarkdown(document), true);
    }

    root.EditorEngine.load().then(function (Vditor) {
      var reserved = { pin: true, exclude: ['upload', 'record', 'fullscreen', 'outline', 'devtools', 'info', 'help', 'emoji', 'insert'] };
      vditor = new Vditor(mount, {
        height: 360,
        mode: 'ir',
        value: '',
        lang: 'zh_CN',
        icon: 'ant',
        cdn: root.EditorEngine.CDN,
        cache: { enable: false },
        placeholder: options.label || '正文…',
        toolbarConfig: reserved,
        input: function () {
          lastDocument = readDocument();
          if (options.onChange) options.onChange();
        },
        after: function () {
          ready = true;
          if (queued) { pushBody(queued); queued = null; }
        }
      });
    }).catch(function () {
      /* 加载失败：退回现有编辑器，写作不受影响。 */
      failed = true;
      mount.hidden = true;
      host.hidden = false;
      if (toolbar) toolbar.hidden = false;
      if (options.onError) options.onError('Vditor 加载失败，已切回原有编辑器。');
      if (queued) { converter.setBody(queued); queued = null; }
    });

    return {
      engine: 'vditor',
      setBody: function (body) {
        if (failed) { converter.setBody(body); return; }
        if (!ready) { queued = body; return; }
        pushBody(body);
      },
      getDocument: function () {
        if (failed) return converter.getDocument();
        return readDocument();
      },
      getSource: function () {
        if (failed) return converter.getSource();
        var document = readDocument();
        return schema ? schema.renderDocument(document, [], max) : '';
      },
      parseSource: function (source, ids, limit) { return converter.parseSource(source, ids, limit); },
      clear: function () {
        lastDocument = { version: 1, blocks: [] };
        if (failed) { converter.clear(); return; }
        if (ready && vditor) vditor.setValue('', true); else queued = null;
      },
      getHTML: function () { return readDocument(); },
      setHTML: function () { throw Error('Community 不接受 HTML。'); },
      insertText: function (value) {
        if (failed) { converter.insertText(value); return; }
        if (ready && vditor) vditor.insertValue(String(value == null ? '' : value));
      },
      insertHTML: function () { throw Error('Community 不接受 HTML。'); },
      insertAsset: function (id, asset) {
        if (!schema || !schema.uuid(id)) throw Error('无效资源 UUID。');
        if (failed) { converter.insertAsset(id, asset); return null; }
        if (ready && vditor) {
          /* 独占一段的资源标记会被转换成 asset 块，文章页据此渲染成图片/附件。 */
          vditor.insertValue('\n\n[[asset:' + id + ']]\n\n');
        }
        return null;
      },
      removeAsset: function (id) {
        if (failed) { converter.removeAsset(id); return; }
        if (!ready || !vditor) return;
        var value = vditor.getValue().split('\n').filter(function (line) { return line.indexOf('[[asset:' + id + ']]') < 0; }).join('\n');
        vditor.setValue(value, false);
      }
    };
  }

  if (!root.ContentEditor) root.ContentEditor = {};
  root.ContentEditor.createVditor = createVditor;
  if (typeof module === 'object' && module.exports) module.exports = { createVditor: createVditor, sanitize: sanitize, toMarkdown: toMarkdown, ASSET_TOKEN: ASSET_TOKEN };
})(typeof window === 'object' ? window : globalThis);
