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
  function validate(type, title, body) {
    if (TYPES.indexOf(type) < 0) throw Error('无效内容类型。');
    string(title, 160, true);
    keys(body, type === 'article' ? ['text','summary','tags','asset_ids'] : type === 'moment' ? ['text','asset_ids'] : ['description','photos']);
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
    return ids;
  }
  var api = {validate:validate, uuid:function (id) { return typeof id === 'string' && UUID.test(id); }, mime:MIME};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommunitySchema = api;
})(typeof window === 'object' ? window : globalThis);
