(function (root, factory) {
  'use strict';
  var api = factory();
  root.BlogSearchCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  var WEIGHTS = { title: 100, tags: 60, category: 40, excerpt: 30, body: 10, text: 50 };
  function normalize(value) { return String(value || '').toLocaleLowerCase(); }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function stripHtml(value) {
    return String(value || '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, function (entity, code) {
        var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        if (code[0] !== '#') return named[code.toLowerCase()] || entity;
        var value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      })
      .replace(/\s+/g, ' ').trim();
  }
  function termsFor(query) {
    return Array.from(new Set(normalize(query).trim().split(/\s+/u).filter(Boolean)));
  }
  function createIndex(posts, moments, comments) {
    var records = [];
    (posts || []).forEach(function (post) {
      var body = stripHtml(post.content);
      records.push({
        type: 'post', slug: post.slug, title: post.title || '', date: post.date || '',
        excerpt: post.excerpt || '', body: body,
        fields: { title: post.title || '', tags: (post.tags || []).join(' '), category: post.category || '', excerpt: post.excerpt || '', body: body }
      });
    });
    (moments || []).forEach(function (moment) {
      records.push({ type: 'moment', id: moment.id, title: moment.text || '', date: moment.time || '',
        fields: { text: moment.text || '' } });
    });
    Object.keys(comments || {}).forEach(function (slug) {
      (comments[slug] || []).forEach(function (comment) {
        records.push({ type: 'comment', slug: slug, id: comment.id, title: (comment.nick || '读者') + '：' + (comment.content || ''),
          date: comment.time || '', fields: { text: comment.content || '' } });
      });
    });
    return records.map(function (record) {
      record.normalizedFields = {};
      Object.keys(record.fields).forEach(function (field) { record.normalizedFields[field] = normalize(record.fields[field]); });
      return record;
    });
  }
  function context(text, terms) {
    var lower = normalize(text);
    var first = -1;
    terms.forEach(function (term) {
      var at = lower.indexOf(term);
      if (at >= 0 && (first < 0 || at < first)) first = at;
    });
    if (first < 0) return text.slice(0, 110) + (text.length > 110 ? '…' : '');
    var start = Math.max(0, first - 35);
    var end = Math.min(text.length, first + 85);
    return (start ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }
  function search(index, query) {
    var terms = termsFor(query);
    if (!terms.length) return [];
    return index.map(function (record) {
      var matched = 0;
      var score = 0;
      terms.forEach(function (term) {
        var best = 0;
        Object.keys(record.normalizedFields).forEach(function (field) {
          if (record.normalizedFields[field].includes(term)) best = Math.max(best, WEIGHTS[field]);
        });
        if (best) { matched += 1; score += best; }
      });
      if (!matched) return null;
      var snippet = record.type === 'post'
        ? (terms.some(function (term) { return record.normalizedFields.body.includes(term); }) ? context(record.body, terms) : context(record.excerpt || record.body, terms))
        : context(record.fields.text, terms);
      return { type: record.type, slug: record.slug, id: record.id, title: record.title,
        date: record.date, snippet: snippet, matched: matched, score: score };
    }).filter(Boolean).sort(function (a, b) {
      return b.matched - a.matched || b.score - a.score || String(b.date).localeCompare(String(a.date));
    });
  }
  function highlight(value, terms) {
    var source = String(value || '');
    var needles = termsFor(terms.join(' ')).sort(function (a, b) { return b.length - a.length; });
    var lower = normalize(source);
    var output = '';
    for (var i = 0; i < source.length;) {
      var match = needles.find(function (term) { return lower.startsWith(term, i); });
      if (match) {
        output += '<mark>' + escapeHtml(source.slice(i, i + match.length)) + '</mark>';
        i += match.length;
      } else {
        output += escapeHtml(source[i]);
        i += 1;
      }
    }
    return output;
  }
  return { createIndex: createIndex, search: search, highlight: highlight, termsFor: termsFor, stripHtml: stripHtml, escapeHtml: escapeHtml };
});
