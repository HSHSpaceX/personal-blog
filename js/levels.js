/* 拾光等级：精选站标 + 用户等级。
 * 纯前端实现，只读取已公开的数据（静态内容、公开快照、公开计数），
 * 不写入数据，也不访问私信、私有附件或未审核内容。
 *
 * 等级不按经验值累加，而是直接看数量：文章、精选、画册、动态、评论、关注。
 * 从 Lv.3 起必须有站长精选文章，光靠数量堆不上去。 */
(function (root) {
  'use strict';

  /* 统计项：顺序即卡片里的展示顺序。 */
  var REQUIREMENTS = [
    { key: 'article', label: '文章' },
    { key: 'featured', label: '精选' },
    { key: 'album', label: '画册' },
    { key: 'moment', label: '动态' },
    { key: 'comment', label: '评论' },
    { key: 'follower', label: '关注' }
  ];

  /* 每级要求：全部达标才升到该级。未列出的项不要求。 */
  var LEVELS = [
    { level: 0, need: {} },
    { level: 1, need: { article: 1 } },
    { level: 2, need: { article: 2, moment: 3 } },
    { level: 3, need: { article: 3, featured: 1, album: 1 } },
    { level: 4, need: { article: 5, featured: 1, album: 2, moment: 10 } },
    { level: 5, need: { article: 8, featured: 2, album: 3, moment: 20, comment: 20 } },
    { level: 6, need: { article: 12, featured: 3, album: 4, moment: 35, comment: 40 } },
    { level: 7, need: { article: 18, featured: 5, album: 6, moment: 60, comment: 80, follower: 20 } },
    { level: 8, need: { article: 25, featured: 7, album: 8, moment: 90, comment: 150, follower: 50 } },
    { level: 9, need: { article: 35, featured: 10, album: 12, moment: 140, comment: 250, follower: 100 } },
    { level: 10, need: { article: 50, featured: 15, album: 16, moment: 200, comment: 400, follower: 200 } }
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

  function emptyCounts(source) {
    var out = { source: source || 'server' };
    REQUIREMENTS.forEach(function (item) { out[item.key] = 0; });
    return out;
  }

  /* 站标：只有站长精选的文章才带这个小标记。 */
  function isFeatured(post) {
    return !!post && post.featured === true;
  }

  function meets(counts, need) {
    return Object.keys(need).every(function (key) {
      return number(counts[key]) >= need[key];
    });
  }

  /* 按数量判定等级：取所有达标等级中最高的一个。 */
  function levelOf(counts) {
    var source = counts || {};
    var index = 0;
    LEVELS.forEach(function (row, i) {
      if (meets(source, row.need)) index = i;
    });
    var current = LEVELS[index];
    var next = LEVELS[index + 1] || null;
    var rows = next ? REQUIREMENTS.filter(function (item) {
      return next.need[item.key] !== undefined;
    }).map(function (item) {
      var have = number(source[item.key]);
      return {
        key: item.key,
        label: item.label,
        need: next.need[item.key],
        have: have,
        met: have >= next.need[item.key]
      };
    }) : [];
    var metRows = rows.filter(function (row) { return row.met; });
    return {
      level: current.level,
      counts: source,
      nextLevel: next ? next.level : null,
      requirements: rows,
      metRequired: metRows.length,
      totalRequired: rows.length,
      missing: rows.filter(function (row) { return !row.met; }),
      progress: rows.length ? metRows.length / rows.length : 1,
      max: !next,
      source: source.source || 'local',
      partial: source.partial === true
    };
  }

  /* 兼容旧调用：compute 直接按数量算等级。 */
  function compute(counts) {
    return levelOf(counts);
  }

  /* 静态内容只能可靠地归属站长（历史文章/动态/评论没有用户 id）。 */
  function localStats(username) {
    var own = !username || String(username).toLowerCase() === 'hshspacex';
    if (!own) return emptyCounts('local');
    var comments = 0;
    var all = root.SITE_COMMENTS || {};
    Object.keys(all).forEach(function (slug) {
      (all[slug] || []).forEach(function (item) {
        if (item && /hsh|站长/i.test(String(item.nick || ''))) comments++;
      });
    });
    var posts = root.BLOG_POSTS || [];
    var counts = emptyCounts('local');
    counts.article = posts.length;
    counts.featured = posts.filter(isFeatured).length;
    counts.moment = (root.BLOG_MOMENTS || root.SITE_MOMENTS || []).length;
    counts.album = (root.SITE_ALBUMS || []).filter(function (album) { return album.visibility !== 'private'; }).length;
    counts.comment = comments;
    return counts;
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

  /* 批量取行再在本地按用户分组，评论列表里几十个人也只要两个请求。 */
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

  /* 只统计已公开的条目：已发布文章/动态/图册 + 已审核评论。 */
  function fetchStats(id) {
    var settings = config();
    if (!settings || !UUID.test(id || '')) return Promise.reject(Error('等级数据暂不可用'));
    var published = { author_id: 'eq.' + id, published_revision_id: 'not.is.null' };
    function type(kind) {
      return Object.assign({}, published, { content_type: 'eq.' + kind });
    }
    var jobs = [
      ['article', 'content_items', type('article')],
      ['featured', 'content_items', Object.assign(type('article'), { featured: 'eq.true' })],
      ['album', 'content_items', type('album')],
      ['moment', 'content_items', type('moment')],
      ['comment', 'comments', { user_id: 'eq.' + id, status: 'eq.approved' }]
    ];
    return Promise.all(jobs.map(function (job) {
      return restCount(settings, job[1], job[2]).then(function (count) { return [job[0], count]; });
    })).then(function (rows) {
      var counts = emptyCounts('server');
      counts.missing = [];
      var partial = false;
      rows.forEach(function (row) {
        counts[row[0]] = row[1] === null ? 0 : row[1];
        if (row[1] === null) { partial = true; counts.missing.push(row[0]); }
      });
      counts.partial = partial;
      return counts;
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
    unique.forEach(function (id) { empty[id] = levelOf(emptyCounts('server')); });
    if (!settings || !unique.length) return Promise.resolve(empty);
    var filter = 'in.(' + unique.join(',') + ')';
    var contentRows = restRows(settings, 'content_items', 'author_id,content_type,featured', {
      author_id: filter, published_revision_id: 'not.is.null'
    });
    var commentRows = restRows(settings, 'comments', 'user_id', { user_id: filter, status: 'eq.approved' });
    return Promise.all([contentRows, commentRows]).then(function (results) {
      var counts = {};
      unique.forEach(function (id) { counts[id] = emptyCounts('server'); });
      var ok = true;
      if (results[0]) {
        results[0].forEach(function (row) {
          var item = counts[row.author_id];
          if (!item) return;
          if (row.content_type === 'article') {
            item.article++;
            if (row.featured === true) item.featured++;
          } else if (row.content_type === 'moment') item.moment++;
          else if (row.content_type === 'album') item.album++;
        });
      } else { ok = false; }
      if (results[1]) {
        results[1].forEach(function (row) {
          var item = counts[row.user_id];
          if (item) item.comment++;
        });
      } else { ok = false; }
      var out = {};
      unique.forEach(function (id) {
        counts[id].partial = !ok;
        out[id] = levelOf(counts[id]);
      });
      return out;
    }).catch(function () { return empty; });
  }

  /* 一位用户的等级：优先用服务器公开计数；失败时退回可见的静态内容。 */
  function profileLevel(profile, followers) {
    var local = localStats(profile && profile.username);
    local.follower = number(followers);
    if (!profile || !profile.id) return Promise.resolve(levelOf(local));
    return fetchStats(profile.id).then(function (counts) {
      (counts.missing || []).forEach(function (key) { counts[key] = local[key]; });
      counts.follower = local.follower;
      return levelOf(counts);
    }).catch(function () {
      return levelOf(local);
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
    if (!info || (info.level === undefined || info.level === null)) return '';
    var title = info.max
      ? '拾光等级 Lv.' + info.level + '（已满级）'
      : '拾光等级 Lv.' + info.level + ' · 距 Lv.' + info.nextLevel + ' 还差 ' + (info.missing || []).length + ' 项';
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

  /* 要求行：达标打勾，未达标显示缺口。 */
  function requirementHTML(rows) {
    return (rows || []).map(function (row) {
      return '<li class="level-req' + (row.met ? ' is-met' : '') + '">' +
        '<span class="level-req-label">' + escape(row.label) + '</span>' +
        '<span class="level-req-count"><b>' + escape(row.have) + '</b>/' + escape(row.need) + '</span>' +
        '</li>';
    }).join('');
  }

  /* 等级卡。options.compact 用于浮动小卡，只列下一级的要求。 */
  function profileCardHTML(info, options) {
    if (!info) return '';
    var compact = !!(options && options.compact);
    var percent = Math.round(info.progress * 1000) / 10;
    var hint = info.max
      ? '已是最高等级'
      : (info.missing && info.missing.length
        ? '距 Lv.' + info.nextLevel + ' 还差 ' + info.missing.length + ' 项'
        : '已达 Lv.' + info.nextLevel + ' 的门槛');
    var detail = compact ? '' :
      '<details class="level-ladder"><summary>等级门槛</summary><ol>' +
      LEVELS.filter(function (row) { return row.level > 0; }).map(function (row) {
        return '<li' + (row.level === info.level ? ' class="is-current"' : '') + '>' +
          '<span>Lv.' + row.level + '</span>' +
          '<span>' + REQUIREMENTS.filter(function (item) { return row.need[item.key] !== undefined; })
            .map(function (item) { return item.label + ' ' + row.need[item.key]; }).join(' · ') + '</span>' +
          '</li>';
      }).join('') + '</ol></details>';
    return '<div class="level-card' + (compact ? ' is-compact' : '') + '" data-level="' + escape(info.level) + '" data-source="' + escape(info.source) + '"' + (info.max ? ' data-max="true"' : '') + '>' +
      '<div class="level-head">' +
        '<span class="level-number">Lv.' + escape(info.level) + '</span>' +
        '<span class="level-eyebrow">拾光等级</span>' +
      '</div>' +
      '<ul class="level-reqs">' + requirementHTML(info.requirements) + '</ul>' +
      '<div class="level-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + info.totalRequired + '" aria-valuenow="' + info.metRequired + '" aria-label="' + escape('拾光等级 Lv.' + info.level + '：下一级要求已完成 ' + info.metRequired + '/' + info.totalRequired + ' 项') + '">' +
        '<span class="level-bar-fill" style="width:' + percent + '%"></span>' +
      '</div>' +
      '<p class="level-hint">' + escape(hint) + '</p>' +
      detail +
      '<p class="level-note">' + escape(info.partial ? '部分公开数据暂时无法读取，稍后会自动补全。' : '按已发布的文章、画册、动态、已审核评论与关注者计算。') + '</p>' +
      '</div>';
  }

  var api = {
    LEVELS: LEVELS,
    REQUIREMENTS: REQUIREMENTS,
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
