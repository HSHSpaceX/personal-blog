/* 拾光等级：精选站标 + 用户等级。
 * 纯前端实现，只读取已公开的数据（静态内容、公开快照、公开计数），
 * 不写入数据，也不访问私信、私有附件或未审核内容。 */
(function (root) {
  'use strict';

  /* 等级门槛：累计经验值达到该值即升级。门槛走高，升级要攒很久。 */
  var LEVELS = [
    { level: 1, exp: 0 },
    { level: 2, exp: 200 },
    { level: 3, exp: 600 },
    { level: 4, exp: 1400 },
    { level: 5, exp: 2600 },
    { level: 6, exp: 4400 },
    { level: 7, exp: 7000 },
    { level: 8, exp: 10500 },
    { level: 9, exp: 15000 },
    { level: 10, exp: 21000 }
  ];

  /* 贡献权重：只使用公开可见的数量，任何人都能复算自己的等级。 */
  var EXP_RULES = [
    { key: 'article', label: '文章', weight: 120 },
    { key: 'moment', label: '动态', weight: 18 },
    { key: 'album', label: '图册', weight: 45 },
    { key: 'comment', label: '评论', weight: 10 },
    { key: 'follower', label: '关注者', weight: 3 }
  ];

  var UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  function escape(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function number(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /* 站标：只有站长精选的文章才带这个小标记。 */
  function isFeatured(post) {
    return !!post && post.featured === true;
  }

  function levelOf(exp) {
    var value = number(exp);
    var index = 0;
    for (var i = 0; i < LEVELS.length; i++) {
      if (value >= LEVELS[i].exp) index = i;
    }
    var current = LEVELS[index];
    var next = LEVELS[index + 1] || null;
    var span = next ? next.exp - current.exp : 0;
    return {
      level: current.level,
      exp: value,
      currentExp: current.exp,
      nextExp: next ? next.exp : null,
      remaining: next ? Math.max(0, next.exp - value) : 0,
      progress: next && span > 0 ? Math.min(1, Math.max(0, (value - current.exp) / span)) : 1,
      max: !next
    };
  }

  /* 把数量折算成经验值，并返回可直接渲染的等级信息。 */
  function compute(stats) {
    var source = stats || {};
    var counts = {}, breakdown = [], exp = 0;
    EXP_RULES.forEach(function (rule) {
      var n = number(source[rule.key]);
      counts[rule.key] = n;
      exp += n * rule.weight;
      breakdown.push({ key: rule.key, label: rule.label, count: n, weight: rule.weight, exp: n * rule.weight });
    });
    var level = levelOf(exp);
    level.counts = counts;
    level.breakdown = breakdown;
    level.source = source.source || 'local';
    level.partial = source.partial === true;
    return level;
  }

  /* 静态内容只能可靠地归属站长（历史文章/动态/评论没有用户 id）。 */
  function localStats(username) {
    var own = !username || String(username).toLowerCase() === 'hshspacex';
    if (!own) return { article: 0, moment: 0, album: 0, comment: 0, follower: 0, source: 'local' };
    var comments = 0;
    var all = root.SITE_COMMENTS || {};
    Object.keys(all).forEach(function (slug) {
      (all[slug] || []).forEach(function (item) {
        if (item && /hsh|站长/i.test(String(item.nick || ''))) comments++;
      });
    });
    return {
      article: (root.BLOG_POSTS || []).length,
      moment: (root.BLOG_MOMENTS || root.SITE_MOMENTS || []).length,
      album: (root.SITE_ALBUMS || []).filter(function (album) { return album.visibility !== 'private'; }).length,
      comment: comments,
      follower: 0,
      source: 'local'
    };
  }

  function config() {
    var value = root.BlogConfig || {};
    return value.SUPABASE_URL && value.SUPABASE_PUBLISHABLE_KEY ? value : null;
  }

  function signal() {
    try {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(6000);
    } catch (error) { /* 老浏览器忽略 */ }
    return undefined;
  }

  function endpoint(settings, table, select, filters) {
    var base = String(settings.SUPABASE_URL).replace(/\/+$/, '');
    var target = new URL(base + '/rest/v1/' + table);
    target.searchParams.set('select', select);
    Object.keys(filters).forEach(function (key) { target.searchParams.set(key, filters[key]); });
    return target.href;
  }

  function headers(settings, extra) {
    var out = { apikey: settings.SUPABASE_PUBLISHABLE_KEY };
    Object.keys(extra || {}).forEach(function (key) { out[key] = extra[key]; });
    return out;
  }

  /* 精确计数：只取响应头里的条数，不下载数据。 */
  function restCount(settings, table, filters) {
    return new Promise(function (resolve) {
      if (!root.fetch) { resolve(null); return; }
      root.fetch(endpoint(settings, table, 'id', filters), {
        headers: headers(settings, { Prefer: 'count=exact', Range: '0-0' }),
        credentials: 'omit', cache: 'no-store', signal: signal()
      }).then(function (response) {
        if (!response.ok) throw Error('HTTP ' + response.status);
        var match = /\/([0-9]+)$/.exec(response.headers.get('content-range') || '');
        if (!match) throw Error('缺少计数');
        resolve(Number(match[1]));
      }).catch(function () { resolve(null); });
    });
  }

  /* 批量取行再在本地按用户分组，评论列表里几十个人也只要三个请求。 */
  function restRows(settings, table, select, filters) {
    return new Promise(function (resolve) {
      if (!root.fetch) { resolve(null); return; }
      root.fetch(endpoint(settings, table, select, filters), {
        headers: headers(settings),
        credentials: 'omit', cache: 'no-store', signal: signal()
      }).then(function (response) {
        if (!response.ok) throw Error('HTTP ' + response.status);
        return response.json();
      }).then(function (rows) {
        resolve(Array.isArray(rows) ? rows : []);
      }).catch(function () { resolve(null); });
    });
  }

  function emptyStats(source) {
    return { article: 0, moment: 0, album: 0, comment: 0, follower: 0, source: source || 'server' };
  }

  /* 只统计已公开的条目：已发布文章/动态/图册 + 已审核评论。 */
  function fetchStats(id) {
    var settings = config();
    if (!settings || !UUID.test(id || '')) return Promise.reject(Error('等级数据暂不可用'));
    var jobs = [
      ['article', 'content_items', { author_id: 'eq.' + id, content_type: 'eq.article', published_revision_id: 'not.is.null' }],
      ['moment', 'content_items', { author_id: 'eq.' + id, content_type: 'eq.moment', published_revision_id: 'not.is.null' }],
      ['album', 'content_items', { author_id: 'eq.' + id, content_type: 'eq.album', published_revision_id: 'not.is.null' }],
      ['comment', 'comments', { user_id: 'eq.' + id, status: 'eq.approved' }]
    ];
    return Promise.all(jobs.map(function (job) {
      return restCount(settings, job[1], job[2]).then(function (count) { return [job[0], count]; });
    })).then(function (rows) {
      var stats = emptyStats('server'), partial = false;
      stats.missing = [];
      rows.forEach(function (row) {
        stats[row[0]] = row[1] === null ? 0 : row[1];
        if (row[1] === null) { partial = true; stats.missing.push(row[0]); }
      });
      stats.partial = partial;
      return stats;
    });
  }

  /* 多人批量：返回 { 用户 id: 等级信息 }，用于评论/回复卡上的等级标识。 */
  function fetchMany(ids) {
    var settings = config();
    var unique = [];
    (ids || []).forEach(function (id) {
      if (UUID.test(String(id || '')) && unique.indexOf(id) < 0) unique.push(id);
    });
    var empty = {};
    unique.forEach(function (id) { empty[id] = compute(emptyStats('server')); });
    if (!settings || !unique.length) return Promise.resolve(empty);
    var filter = 'in.(' + unique.join(',') + ')';
    var contentRows = restRows(settings, 'content_items', 'author_id,content_type', {
      author_id: filter, published_revision_id: 'not.is.null'
    });
    var commentRows = restRows(settings, 'comments', 'user_id', { user_id: filter, status: 'eq.approved' });
    return Promise.all([contentRows, commentRows]).then(function (results) {
      var stats = {};
      unique.forEach(function (id) { stats[id] = emptyStats('server'); });
      var ok = true;
      if (results[0]) {
        results[0].forEach(function (row) {
          var item = stats[row.author_id];
          if (!item) return;
          if (row.content_type === 'article') item.article++;
          else if (row.content_type === 'moment') item.moment++;
          else if (row.content_type === 'album') item.album++;
        });
      } else { ok = false; }
      if (results[1]) {
        results[1].forEach(function (row) {
          var item = stats[row.user_id];
          if (item) item.comment++;
        });
      } else { ok = false; }
      var out = {};
      unique.forEach(function (id) {
        stats[id].partial = !ok;
        out[id] = compute(stats[id]);
      });
      return out;
    }).catch(function () { return empty; });
  }

  /* 一位用户的等级：优先用服务器公开计数；失败时退回可见的静态内容。 */
  function profileLevel(profile, followers) {
    var local = localStats(profile && profile.username);
    local.follower = number(followers);
    var declared = profile && Number(profile.exp);
    if (Number.isFinite(declared) && profile.exp !== null && profile.exp !== '') {
      var declaredLevel = levelOf(declared);
      declaredLevel.counts = {};
      declaredLevel.breakdown = [];
      declaredLevel.source = 'profile';
      return Promise.resolve(declaredLevel);
    }
    if (!profile || !profile.id) return Promise.resolve(compute(local));
    return fetchStats(profile.id).then(function (stats) {
      (stats.missing || []).forEach(function (key) { stats[key] = local[key]; });
      stats.follower = local.follower;
      return compute(stats);
    }).catch(function () {
      return compute(local);
    });
  }

  function sealHTML() {
    return '<span class="tier-seal" role="img" aria-label="拾光手记精选文章">' +
      '<span class="tier-seal-mark" aria-hidden="true"></span>' +
      '<span class="tier-seal-label">精选</span>' +
      '</span>';
  }

  /* 评论/回复卡上的小等级标识。 */
  function chipHTML(info) {
    if (!info || !info.level) return '';
    var title = info.max
      ? '拾光等级 Lv.' + info.level + '（已满级）'
      : '拾光等级 Lv.' + info.level + ' · ' + info.exp + '/' + info.nextExp + ' 经验值';
    return '<span class="level-chip" data-level="' + escape(info.level) + '" title="' + escape(title) + '" aria-label="' + escape(title) + '">Lv.' + escape(info.level) + '</span>';
  }

  /* 把容器里所有 data-level-user 占位填成等级标识；失败就保持空白。 */
  function decorateComments(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return Promise.resolve(0);
    var nodes = [].slice.call(container.querySelectorAll('[data-level-user]'));
    if (!nodes.length) return Promise.resolve(0);
    var ids = nodes.map(function (node) { return node.getAttribute('data-level-user'); });
    return fetchMany(ids).then(function (map) {
      var filled = 0;
      nodes.forEach(function (node) {
        var info = map[node.getAttribute('data-level-user')];
        var html = info ? chipHTML(info) : '';
        if (html) { node.innerHTML = html; filled++; }
      });
      return filled;
    }).catch(function () { return 0; });
  }

  function profileCardHTML(info) {
    if (!info) return '';
    var percent = Math.round(info.progress * 1000) / 10;
    var expLine = info.max
      ? '<b>' + info.exp + '</b> <span>经验值 · 已满级</span>'
      : '<b>' + info.exp + '</b> <span>/ ' + info.nextExp + '</span>';
    var hint = info.max
      ? '已是最高等级'
      : '距 Lv.' + (info.level + 1) + ' 还差 ' + info.remaining + ' 经验值';
    var stats = (info.breakdown || []).map(function (item) {
      return '<span class="level-stat' + (item.count ? '' : ' is-zero') + '"><span>' + escape(item.label) + '</span> <b>' + item.count + '</b></span>';
    }).join('<span class="level-dot" aria-hidden="true">·</span>');
    return '<div class="level-card" data-level="' + escape(info.level) + '" data-source="' + escape(info.source) + '"' + (info.max ? ' data-max="true"' : '') + '>' +
      '<p class="level-eyebrow">拾光等级</p>' +
      '<div class="level-row">' +
        '<span class="level-number">Lv.' + escape(info.level) + '</span>' +
        '<span class="level-exp">' + expLine + '</span>' +
      '</div>' +
      '<div class="level-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + (info.nextExp === null ? info.exp : info.nextExp) + '" aria-valuenow="' + info.exp + '" aria-label="' + escape('拾光等级 Lv.' + info.level + '：' + info.exp + ' 经验值') + '">' +
        '<span class="level-bar-fill" style="width:' + percent + '%"></span>' +
      '</div>' +
      '<p class="level-hint">' + escape(hint) + '</p>' +
      '<div class="level-stats">' + stats + '</div>' +
      '<p class="level-note">' + escape(info.partial ? '部分公开数据暂时无法读取，稍后会自动补全。' : '按公开文章、动态、图册、评论与关注者自动统计。') + '</p>' +
      '</div>';
  }

  var api = {
    LEVELS: LEVELS,
    EXP_RULES: EXP_RULES,
    escape: escape,
    isFeatured: isFeatured,
    levelOf: levelOf,
    compute: compute,
    localStats: localStats,
    fetchStats: fetchStats,
    fetchMany: fetchMany,
    profileLevel: profileLevel,
    sealHTML: sealHTML,
    chipHTML: chipHTML,
    decorateComments: decorateComments,
    profileCardHTML: profileCardHTML
  };
  root.SiteLevels = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
