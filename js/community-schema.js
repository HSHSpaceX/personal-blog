(function (root) {
  'use strict';
  var UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  var TYPES = ['article', 'moment', 'album'];
  var MIME = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','application/pdf':'pdf','text/plain':'txt'};
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function length(value) { return Array.from(value).length; }
  function string(value, max, required) {
    if (typeof value !== 'string' || length(value) > max || (required && !value.trim())) throw Error('文本长度或格式无效。');
  }
  function keys(value, allowed) {
    if (!object(value) || Object.keys(value).some(function (key) { return allowed.indexOf(key) < 0; })) throw Error('内容包含不允许的字段。');
  }
  function Content_IsSafeLink(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s<>"'\\\x00-\x1f\x7f]/.test(value)) return false;
    if (!/^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s]*)?$/.test(value) && !/^mailto:[^?@]+@[A-Za-z0-9.-]+$/.test(value)) return false;
    try { var url = new URL(value); return ['https:','http:','mailto:'].includes(url.protocol) && !url.username && !url.password && (url.protocol === 'mailto:' ? /^[^?]+@[^?]+$/.test(url.pathname) && !url.search : !!url.hostname); } catch (error) { return false; }
  }
  function Content_ValidateInline(runs) {
    if (!Array.isArray(runs) || runs.length > 1000) throw Error('无效行内内容。');
    runs.forEach(function (run) {
      keys(run, ['text','marks','href']); string(run.text,100000,false);
      if ('marks' in run && (!Array.isArray(run.marks) || run.marks.length > 2 || new Set(run.marks).size !== run.marks.length || run.marks.some(function(m){return !['bold','italic'].includes(m);}))) throw Error('无效文字格式。');
      if ('href' in run && !Content_IsSafeLink(run.href)) throw Error('链接协议或地址不安全。');
    });
  }
  function Content_ValidateDocument(document, ids, max) {
    keys(document,['version','blocks']);
    if (document.version !== 1 || !Array.isArray(document.blocks) || document.blocks.length > 200) throw Error('无效正文版本或块数量。');
    document.blocks.forEach(function(block){
      if (!object(block)) throw Error('无效正文块。');
      if (block.type === 'asset') { keys(block,['type','asset_id']); if (typeof block.asset_id !== 'string' || !UUID.test(block.asset_id) || !ids.includes(block.asset_id.toLowerCase())) throw Error('正文资源必须已被此版本引用。'); }
      else if (block.type === 'list') { keys(block,['type','ordered','items']); if (typeof block.ordered !== 'boolean' || !Array.isArray(block.items) || !block.items.length || block.items.length>100) throw Error('无效列表。'); block.items.forEach(Content_ValidateInline); }
      else { keys(block,block.type==='heading'?['type','level','runs']:['type','runs']); if (!['paragraph','heading','quote','code'].includes(block.type) || (block.type==='heading' && ![2,3].includes(block.level))) throw Error('不支持的正文块。'); Content_ValidateInline(block.runs); }
    });
    string(Content_DocumentText(document),max,false);
    return document;
  }
  function Content_DocumentText(document) {
    return document.blocks.filter(function(b){return b.type!=='asset';}).map(function(b){return b.type==='list'?b.items.map(function(r){return r.map(function(x){return x.text;}).join('');}).join('\n'):b.runs.map(function(r){return r.text;}).join('');}).join('\n\n');
  }
  function Content_Escape(value) { return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function Content_RenderDocument(document, ids, max, assetHTML) {
    Content_ValidateDocument(document,ids,max);
    function Content_RenderInline(runs) { return runs.map(function(r){var text=Content_Escape(r.text).replace(/\n/g,'<br>'); if((r.marks||[]).includes('bold'))text='<strong>'+text+'</strong>';if((r.marks||[]).includes('italic'))text='<em>'+text+'</em>';if(r.href)text='<a href="'+Content_Escape(r.href)+'" rel="noopener noreferrer nofollow">'+text+'</a>';return text;}).join(''); }
    return document.blocks.map(function(b){if(b.type==='asset')return assetHTML?assetHTML(b.asset_id):'<p data-content-asset="'+Content_Escape(b.asset_id)+'">附件</p>';if(b.type==='list'){var tag=b.ordered?'ol':'ul';return '<'+tag+'>'+b.items.map(function(r){return '<li>'+Content_RenderInline(r)+'</li>';}).join('')+'</'+tag+'>';}var tag=b.type==='heading'?'h'+b.level:b.type==='quote'?'blockquote':b.type==='code'?'pre':'p';return '<'+tag+'>'+Content_RenderInline(b.runs)+'</'+tag+'>';}).join('');
  }
  function validate(type, title, body) {
    if (TYPES.indexOf(type) < 0) throw Error('无效内容类型。');
    string(title, 160, true);
    keys(body, type === 'article' ? ['text','summary','tags','asset_ids','category','document','cover_asset_id'] : type === 'moment' ? ['text','asset_ids','document'] : ['description','photos','document']);
    if ('category' in body) { string(body.category,40,true); if (/[<>]/.test(body.category)) throw Error('分类须为纯文本。'); }
    var ids = [];
    if (type === 'album') {
      if ('description' in body) string(body.description, 2000, false);
      if (!Array.isArray(body.photos) || !body.photos.length || body.photos.length > 100) throw Error('图册需要 1–100 张图片。');
      body.photos.forEach(function (photo) {
        keys(photo, ['asset_id','caption']);
        if (!UUID.test(photo.asset_id) || typeof photo.asset_id !== 'string') throw Error('无效资源 UUID。');
        if ('caption' in photo) string(photo.caption, 200, false);
        ids.push(photo.asset_id.toLowerCase());
      });
    } else {
      string(body.text, type === 'article' ? 100000 : 2000, true);
      if ('summary' in body) string(body.summary, 500, false);
      if ('tags' in body) {
        if (!Array.isArray(body.tags) || body.tags.length > 10) throw Error('最多 10 个标签。');
        body.tags.forEach(function (tag) { string(tag, 30, true); });
      }
      if ('asset_ids' in body) {
        if (!Array.isArray(body.asset_ids) || body.asset_ids.length > (type === 'article' ? 20 : 9)) throw Error('引用资源数量超出限制。');
        body.asset_ids.forEach(function (id) { if (typeof id !== 'string' || !UUID.test(id)) throw Error('无效资源 UUID。'); ids.push(id.toLowerCase()); });
      }
    }
    if (new Set(ids).size !== ids.length) throw Error('不能重复引用同一资源。');
    if ('document' in body) { Content_ValidateDocument(body.document,ids,type==='article'?100000:2000); if (Content_DocumentText(body.document) !== (type==='album' ? body.description||'' : body.text)) throw Error('正文文本与结构化格式不一致。'); }
    if ('cover_asset_id' in body && (typeof body.cover_asset_id!=='string' || !UUID.test(body.cover_asset_id) || !ids.includes(body.cover_asset_id.toLowerCase()))) throw Error('封面必须引用此版本的资源。');
    return ids;
  }
  var api = {validate:validate, uuid:function (id) { return typeof id === 'string' && UUID.test(id); }, mime:MIME, safeLink:Content_IsSafeLink, validateDocument:Content_ValidateDocument, documentText:Content_DocumentText, renderDocument:Content_RenderDocument};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommunitySchema = api;
})(typeof window === 'object' ? window : globalThis);
