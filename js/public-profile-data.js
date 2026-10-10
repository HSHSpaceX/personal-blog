(function () {
  'use strict';
  var auth=window.BlogAuth;
  var fields='id,username,display_name,avatar_url,bio';
  function value(r){if(r.error){var error=new Error(window.BlogData&&window.BlogData.errorMessage?window.BlogData.errorMessage(r.error):r.error.message);error.code=r.error.code;throw error;}return r.data;}
  async function client(){await auth.ready();if(!auth.configured())throw Error('用户资料暂不可用：Supabase 尚未配置。');return auth.client();}
  async function rpc(name,args){return value(await (await client()).rpc(name,args));}
  async function profile(query){
    var db=await client();
    if(query.username&&!/^[a-zA-Z0-9_]{3,30}$/.test(query.username))throw Error('无效用户名。');
    if(query.id&&!window.CommunitySchema.uuid(query.id))throw Error('无效用户链接。');
    return value(await db.from('profiles').select(fields).eq(query.username?'username':'id',query.username||query.id).maybeSingle());
  }
  function page(name,id,offset,type){var args={p_user_id:id,p_limit:20,p_offset:offset};if(type)args.p_type=type;return rpc(name,args);}
  function legacy(type){
    var rows=[];
    if(type==='article')rows=(window.BLOG_POSTS||[]).map(function(p){return {kind:'article',target_type:'post',target_id:p.slug,title:p.title,text:p.excerpt||'',published_at:p.date,target_path:'posts/'+encodeURIComponent(p.slug)+'.html'};});
    if(type==='moment')rows=(window.BLOG_MOMENTS||window.SITE_MOMENTS||[]).map(function(p){return {kind:'moment',target_type:'moment',target_id:p.id,title:'动态',text:p.text||'',published_at:p.time,target_path:'moments.html#moment-'+encodeURIComponent(p.id)};});
    if(type==='album')rows=(window.SITE_ALBUMS||[]).filter(function(p){return p.visibility!=='private';}).map(function(p){return {kind:'album',target_type:'album',target_id:p.id,title:p.title,text:p.description||'',published_at:p.created,target_path:'gallery.html?album='+encodeURIComponent(p.id)};});
    return rows.map(function(r){return Object.assign(r,{legacy:true,username:'hshspacex',display_name:'HSH(站长)',avatar_url:'assets/icon.jpg'});}).sort(function(a,b){return String(b.published_at).localeCompare(String(a.published_at));});
  }
  // Recheck legacy activity against the currently loaded trusted static catalog.
  function resolveLegacy(card){
    if(!card.legacy)return card;
    if(card.target_type==='post'&&card.target_id==='about')return card;
    var match=legacy(card.kind).find(function(p){return p.target_id===card.target_id;});
    return match?Object.assign({},match,{liked_at:card.liked_at}):null;
  }
  window.PublicProfileData={profile:profile,legacy:legacy,resolveLegacy:resolveLegacy,
    counts:async function(id){return Promise.all([rpc('follower_count',{p_target_id:id}),rpc('following_count',{p_user_id:id})]);},
    followers:function(id,offset){return page('profile_followers',id,offset);},following:function(id,offset){return page('profile_following',id,offset);},
    content:function(id,type,offset){return page('profile_content',id,offset,type);},likes:function(id,offset){return page('profile_recent_likes',id,offset);},
    item:async function(id){if(!window.CommunitySchema.uuid(id))throw Error('无效内容链接。');var db=await client();
      var item=value(await db.from('content_items').select('id,published_revision_id').eq('id',id).maybeSingle());
      if(!item||!item.published_revision_id)throw Error('内容未公开或不存在。');
      // Explicit current-pointer predicate even for an owner/admin session.
      var row=value(await db.from('content_revisions').select('id,title,body,status,content_items!content_revisions_item_id_fkey(author_id,content_type)').eq('id',item.published_revision_id).eq('status','approved').maybeSingle());
      if(!row)throw Error('内容未公开或不存在。');
      return Object.assign({kind:row.content_items.content_type,target_type:'content',target_id:item.id,revision_id:row.id,title:row.title,text:row.body.text||row.body.description||'',body:row.body},await window.BlogData.getProfile(row.content_items.author_id));
    }};
})();
