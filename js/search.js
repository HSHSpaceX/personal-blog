(function () {
  'use strict';
  var core = window.BlogSearchCore;
  var input = document.getElementById('searchInput');
  var tabs = document.getElementById('searchTabs');
  var results = document.getElementById('searchResults');
  var index = [];
  var ready = false;
  var timer = null;
  var types = [
    { id: 'all', label: '全部' }, { id: 'post', label: '文章' },
    { id: 'moment', label: '动态' }, { id: 'comment', label: '评论' }, {id:'user',label:'用户'}
  ];
  var selectedType = 'all',featuredOnly=false,userSerial=0,userRows=[],userOffset=0,userBusy=false,userHasMore=false;
  var featuredButton=document.getElementById('searchFeatured'),userSection=document.getElementById('searchUserSection'),userResults=document.getElementById('searchUserResults'),userStatus=document.getElementById('searchUserStatus'),userMore=document.getElementById('searchUserMore');

  function readLocation() {
    var params = new URLSearchParams(window.location.search);
    input.value = params.get('q') || '';
    var type = params.get('type') || 'all';
    selectedType = types.some(function (item) { return item.id === type; }) ? type : 'all';
    featuredOnly=params.get('featured')==='1'&&['all','post'].includes(selectedType);if(featuredOnly)selectedType='post';
  }
  function writeLocation(replace) {
    var next = new URL(window.location.href);
    var query = input.value.trim();
    if (query) next.searchParams.set('q', query);
    else next.searchParams.delete('q');
    if (selectedType !== 'all') next.searchParams.set('type', selectedType);
    else next.searchParams.delete('type');
    if(featuredOnly)next.searchParams.set('featured','1');else next.searchParams.delete('featured');
    window.history[replace ? 'replaceState' : 'pushState']({}, '', next.pathname + next.search + next.hash);
  }
  function resultUrl(hit) {
    if (hit.type === 'post') return window.BlogUrls.postUrl(hit.slug);
    if (hit.type === 'moment') return 'moments.html#'+(hit.community?'community-':'moment-') + encodeURIComponent(hit.id);
    if(hit.slug&&hit.slug.startsWith('community-')&&window.COMMUNITY_PUBLIC){var i=window.COMMUNITY_PUBLIC.items.find(function(i){return 'community-'+i.id===hit.slug;});return i?window.CommunityPublic.target(i):'moments.html';}
    if(hit.slug&&hit.slug.startsWith('album-'))return 'gallery.html?album='+encodeURIComponent(hit.slug.slice(6));
    if (hit.slug === 'about') return 'about.html#commentsSection';
    if (hit.slug && hit.slug.indexOf('moment-') === 0) return 'moments.html#' + encodeURIComponent(hit.slug);
    return window.BlogUrls.postUrl(hit.slug) + '#commentsSection';
  }
  function render() {
    if (!ready) return;
    var query = input.value.trim();
    var hits = core.search(index, query,{featured:featuredOnly});
    featuredButton.setAttribute('aria-pressed',String(featuredOnly));document.getElementById('searchScope').textContent=featuredOnly?'当前只搜索已公开精选文章':'';userSection.hidden=featuredOnly||!['all','user'].includes(selectedType);results.hidden=selectedType==='user';
    var counts = { all: hits.length, post: 0, moment: 0, comment: 0 };
    hits.forEach(function (hit) { counts[hit.type] += 1; });
    tabs.innerHTML = types.map(function (type) {
      return '<button type="button" class="filter-chip' + (selectedType === type.id ? ' active' : '') +
        '" data-type="' + type.id + '" aria-pressed="' + (selectedType === type.id) + '">' +
        type.label + (type.id==='user'?'':(type.id==='all'?' · 内容 ':' ')+counts[type.id]) + '</button>';
    }).join('');
    if (selectedType==='user'){results.replaceChildren();return;}
    if (!query) {
      results.innerHTML = '<p class="empty-state">输入关键词开始搜索。</p>';
      return;
    }
    var shown = selectedType === 'all' ? hits : hits.filter(function (hit) { return hit.type === selectedType; });
    if (!shown.length) {
      results.innerHTML = '<p class="empty-state">没有找到相关内容。</p>';
      return;
    }
    var terms = core.termsFor(query);
    results.innerHTML = shown.map(function (hit) {
      var label = types.find(function (type) { return type.id === hit.type; }).label;
      var title = hit.type === 'post' ? hit.title : hit.title.slice(0, 64) + (hit.title.length > 64 ? '…' : '');
      return '<a class="search-hit" href="' + core.escapeHtml(resultUrl(hit)) + '">' +
        '<div class="search-hit-head"><span class="search-hit-type">' + label +
        '</span><span class="search-hit-date">' + core.escapeHtml(hit.date) + '</span></div>' +
        '<h3>' + core.highlight(title, terms) + '</h3>' +
        (hit.snippet ? '<p>' + core.highlight(hit.snippet, terms) + '</p>' : '') +
        '</a>';
    }).join('');
  }
  function Search_ResetUsers(){userSerial++;userRows=[];userOffset=0;userBusy=false;userHasMore=false;userResults.replaceChildren();userMore.hidden=true;userMore.disabled=false;userStatus.textContent='';userSection.setAttribute('aria-busy','false');}
  function Search_RenderUsers(){
    userResults.replaceChildren();userRows.forEach(function(p){
      if(!/^[a-zA-Z0-9_]{3,30}$/.test(p.username||''))return;
      var card=document.createElement('a');card.className='search-hit search-user glass-card';card.href='profile.html?username='+encodeURIComponent(p.username);card.rel='nofollow';
      var head=document.createElement('div');head.className='search-user-head';var img=document.createElement('img');img.dataset.avatarId=p.id;img.src=window.PublicCards.avatar(p.avatar_url);img.alt=(p.display_name||p.username)+'的头像';img.loading='lazy';img.addEventListener('error',function(){if(img.getAttribute('src')!=='assets/avatar-default.jpg')img.src='assets/avatar-default.jpg';});head.appendChild(img);
      var names=document.createElement('div'),name=document.createElement('h3'),username=document.createElement('span');name.textContent=p.display_name||p.username;username.textContent='@'+p.username;names.append(name,username);head.appendChild(names);card.appendChild(head);
      var bio=document.createElement('p');bio.textContent=String(p.bio||'暂无公开简介').slice(0,180);card.appendChild(bio);userResults.appendChild(card);
    });
  }
  async function Search_LoadUsers(more){
    if(userSection.hidden||userBusy)return;var query=input.value.trim(),length=Array.from(query).length;
    if(length<2||length>80){userStatus.textContent=query?'用户搜索请输入 2–80 个字符。':'输入至少 2 个字符搜索公开用户。';return;}
    var serial=++userSerial;userBusy=true;userMore.disabled=true;userSection.setAttribute('aria-busy','true');userStatus.textContent='正在搜索公开用户…';
    try{
      var rows=await window.PublicProfileData.search(query,more?userOffset:0);if(serial!==userSerial||query!==input.value.trim()||userSection.hidden)return;
      rows=Array.isArray(rows)?rows:[];var known=new Set(userRows.map(function(p){return p.username;}));rows.forEach(function(p){if(!known.has(p.username)){known.add(p.username);userRows.push(p);}});userOffset+=rows.length;userHasMore=rows.length===20&&userOffset<=200;
      Search_RenderUsers();userStatus.textContent=userRows.length?'已加载 '+userRows.length+' 位公开用户'+(userHasMore?'，可继续加载；此数不是全站匹配总数。':userOffset>200?'，已达到搜索页数上限，请缩小关键词。':'。'):'没有找到相关公开用户。';userMore.hidden=!userHasMore;
    }catch(error){if(serial===userSerial){userStatus.textContent='用户搜索暂不可用：'+error.message;userMore.textContent='重试用户搜索';userMore.hidden=false;}}
    finally{if(serial===userSerial){userBusy=false;userMore.disabled=false;userSection.setAttribute('aria-busy','false');}}
  }
  function Search_Run(){Search_ResetUsers();render();Search_LoadUsers(false);}
  async function initialize() {
    if (ready) return;
    var comments = window.SITE_COMMENTS || {};
    try {
      await window.BlogAuth.ready();
      if (window.BlogAuth.configured()) {
        comments = {};
        var result = await window.BlogAuth.client().from('comments')
          .select('id,post_slug,legacy_author_name,content,created_at').eq('status', 'approved').order('created_at', { ascending: false });
        if (result.error) throw result.error;
        result.data.forEach(function (row) {
          if (!comments[row.post_slug]) comments[row.post_slug] = [];
          comments[row.post_slug].push({ id: row.id, nick: row.legacy_author_name || '读者', content: row.content, time: row.created_at.slice(0, 10) });
        });
      }
    } catch (error) { comments = window.SITE_COMMENTS || {}; }
    var posts=window.CommunityPublic?window.CommunityPublic.mergePosts(window.BLOG_POSTS):window.BLOG_POSTS||[],moments=window.CommunityPublic?window.CommunityPublic.mergeMoments(window.BLOG_MOMENTS):window.BLOG_MOMENTS||[];
    var allowed=new Set(['about'].concat(posts.map(function(p){return p.community?'community-'+p.item_id:p.slug;}),moments.map(function(m){return (m.community?'community-':'moment-')+m.id;}),(window.SITE_ALBUMS||[]).filter(function(a){return a.visibility!=='private';}).map(function(a){return 'album-'+a.id;}),(window.COMMUNITY_PUBLIC?window.COMMUNITY_PUBLIC.items:[]).filter(function(i){return i.content_type==='album';}).map(function(i){return 'community-'+i.id;})));
    Object.keys(comments).forEach(function(slug){if(!allowed.has(slug))delete comments[slug];});
    index = core.createIndex(posts, moments, comments);
    ready = true;
    Search_Run();
  }
  readLocation();writeLocation(true);
  input.addEventListener('input', function () {
    window.clearTimeout(timer);Search_ResetUsers();userSection.setAttribute('aria-busy','false');
    timer = window.setTimeout(function () { writeLocation(true); Search_Run(); }, 250);
  });
  tabs.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-type]');
    if (!button) return;
    window.clearTimeout(timer);selectedType = button.dataset.type;if(!['all','post'].includes(selectedType))featuredOnly=false;if(featuredOnly&&selectedType==='all')selectedType='post';
    writeLocation(false);Search_Run();
  });
  featuredButton.addEventListener('click',function(){window.clearTimeout(timer);featuredOnly=!featuredOnly;if(featuredOnly)selectedType='post';writeLocation(false);Search_Run();});
  userMore.addEventListener('click',function(){userMore.textContent='查看更多用户';Search_LoadUsers(userRows.length>0);});
  document.addEventListener('blog-auth-change',function(){Search_Run();});
  window.addEventListener('popstate', function () {window.clearTimeout(timer);readLocation();Search_Run();});
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
    var target = event.target;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    input.focus();
  });
  document.getElementById('year').textContent = new Date().getFullYear();
  if ((!window.CommunityPublic || window.COMMUNITY_PUBLIC) && window.BLOG_POSTS && window.BLOG_MOMENTS && window.SITE_COMMENTS) initialize();
  else document.addEventListener('posts-ready', initialize, { once: true });
})();
