(function () {
  'use strict';
  var auth = window.BlogAuth, schema = window.CommunitySchema, generation = 0;
  document.addEventListener('blog-auth-change',function(){generation++;});
  function Community_CaptureActor(){return {id:auth.requireUser().id,generation:generation};}
  function Community_ActorActive(actor){return generation===actor.generation&&auth.user()&&auth.user().id===actor.id;}
  function Community_CheckActor(actor){if(!Community_ActorActive(actor))throw Error('账号已变化；操作已取消。');}
  var itemFields = 'id,author_id,content_type,slug,published_revision_id,featured,deleted_at,draft_title';
  var revisionFields = 'content_revision_trash(restored_at,reason),*,content_items!content_revisions_item_id_fkey(' + itemFields + ',content_revision_trash(restored_at,reason))';
  function Community_FormatError(error) { return error && (['PGRST202','PGRST205','42883','42P01'].includes(error.code) || /Could not find (?:the function|the table).*schema cache/i.test(error.message||'')) ? '当前连接的 Supabase 环境尚未部署所需表或 RPC。请站长核对项目配置、按顺序执行 migrations 并刷新 schema cache；此操作未完成。' : error.message; }
  function value(result) { if (result.error) { var error=new Error(Community_FormatError(result.error));error.code=result.error.code;throw error; } return result.data; }
  async function client() { await auth.ready(); auth.requireUser(); return auth.client(); }
  async function rpc(name, args) { var actor=Community_CaptureActor(),db=await client();Community_CheckActor(actor);if(!['community_assets_page','community_asset_references','community_orphan_assets','community_review_cycle_status','community_review_queue'].includes(name)){await window.BackendCapabilities.requireUpgrade();Community_CheckActor(actor);}var result=await db.rpc(name,args);Community_CheckActor(actor);return value(result); }
  async function listItems() {
    var actor=Community_CaptureActor(),db = await client();Community_CheckActor(actor);
    var result=await db.from('content_items').select(itemFields+',created_at,community_publication_state(status,last_error,published_revision_id),content_revisions!content_revisions_item_id_fkey(id,title,status,rejection_reason,revision_no,created_at,summary:body->>summary)')
      .eq('author_id',actor.id).order('created_at',{ascending:false}).limit(50)
      .order('revision_no',{referencedTable:'content_revisions',ascending:false}).limit(1,{referencedTable:'content_revisions'});
    Community_CheckActor(actor);return value(result);
  }
  async function getRevision(id) {
    if (!schema.uuid(id)) throw Error('无效版本链接。');
    var db = await client();
    var row = value(await db.from('content_revisions').select(revisionFields).eq('id',id).maybeSingle());
    if (!row) throw Error('此版本不存在或你没有访问权限。');
    return row;
  }
  async function save(item, title, body) {
    schema.validate(item.content_type,title,body);
    return rpc('community_save_revision',{p_item_id:item.id,p_title:title,p_body:body});
  }
  async function create(type, slug, title, body) {
    schema.validate(type,title,body);
    return rpc('community_create_draft',{p_content_type:type,p_slug:slug,p_title:title,p_body:body});
  }
  async function listAssets() {
    return rpc('community_assets_page',{p_search:'',p_kind:'all',p_limit:20,p_offset:0});
  }
  async function upload(file) {
    var actor=Community_CaptureActor(),db=await client();Community_CheckActor(actor);
    await window.BackendCapabilities.requireUpgrade();Community_CheckActor(actor);
    if (!schema.mime[file.type] || file.size < 1 || file.size > 90*1024*1024) throw Error('支持 JPG/PNG/WebP/MP4/PDF/TXT，文件须为 1 字节至 90 MiB。');
    var path = actor.id + '/' + crypto.randomUUID() + '.' + schema.mime[file.type];
    if(file.size>6*1024*1024)await window.CommunityUpload.upload(file,{url:window.BlogConfig.SUPABASE_URL,anonKey:window.BlogConfig.SUPABASE_PUBLISHABLE_KEY,path:path,session:async function(){return value(await db.auth.getSession()).session;},checkIdentity:function(){Community_CheckActor(actor);}});
    else value(await db.storage.from('community-assets').upload(path,file,{contentType:file.type,upsert:false}));
    // Recheck identity before registration. If interrupted, retain the exact path
    // for safe orphan cleanup; never register or remove another account's file.
    if (!Community_ActorActive(actor)) throw Error('账号已变化；未登记的上传留待资源清理。');
    try { var result=await db.rpc('community_register_asset',{p_object_path:path,p_original_name:file.name});Community_CheckActor(actor);return value(result); }
    catch (error) {
      if (Community_ActorActive(actor)) {
        var cleanup = await db.storage.from('community-assets').remove([path]);
        if (cleanup.error) throw Error('资源登记失败且清理未完成：'+error.message+'；对象路径：'+path);
      }
      throw error;
    }
  }
  async function signedAsset(id) {
    var actor=Community_CaptureActor(),db=await client();Community_CheckActor(actor);
    var asset=value(await db.from('user_assets').select('id,original_name,mime_type,object_path').eq('id',id).maybeSingle());
    if (!asset) throw Error('资源不可访问。');
    Community_CheckActor(actor);var issuedAt=Date.now();var result=value(await db.storage.from('community-assets').createSignedUrl(asset.object_path,60));Community_CheckActor(actor);if(Date.now()>=issuedAt+60000)throw Error('链接已过期，请重试。');
    var url=new URL(result.signedUrl), origin=new URL(window.BlogConfig.SUPABASE_URL);
    if (url.protocol!=='https:' || url.origin!==origin.origin) throw Error('无效资源地址。');
    return {asset:asset,url:url.href,expiresAt:issuedAt+60000};
  }
  async function listReviews() {
    var db=await client(); auth.requireAdmin();
    var reviews=value(await db.from('content_reviews').select('revision_id').eq('status','pending').order('created_at',{ascending:true}).limit(100));
    if (!reviews.length) return [];
    return value(await db.from('content_revisions').select(revisionFields).in('id',reviews.map(function (r) {return r.revision_id;})).order('submitted_at',{ascending:true}));
  }
  async function policyUser(name) {
    var db=await client(); auth.requireAdmin();
    if (!schema.uuid(name) && !/^[a-zA-Z0-9_]{3,30}$/.test(name)) throw Error('请输入用户名或用户 UUID。');
    var user=value(await db.from('profiles').select('id,username,display_name').eq(schema.uuid(name)?'id':'username',name).maybeSingle());
    if (!user) throw Error('找不到该用户。'); return user;
  }
  async function removePrivate(name,args) {
    var actor=Community_CaptureActor(),db=await client();Community_CheckActor(actor);
    await window.BackendCapabilities.requireUpgrade();Community_CheckActor(actor);var path=value(await db.rpc(name,args));
    Community_CheckActor(actor);
    if(typeof path!=='string'||path.split('/')[0]!==actor.id||path.split('/').some(function(p){return p==='.'||p==='..';}))throw Error('无效资源路径。');
    value(await db.storage.from('community-assets').remove([path]));Community_CheckActor(actor);value(await db.rpc('private_object_finish_deletes'));
  }
  window.CommunityData = {createAlbum:function(slug,title){return rpc('community_create_album',{p_slug:slug,p_title:title});},createItem:function(type,slug){return rpc('community_create_item',{p_content_type:type,p_slug:slug});},deleteMoment:function(id){return rpc('community_delete_moment',{p_item_id:id});},errorMessage:Community_FormatError,listItems:listItems,getRevision:getRevision,save:save,create:create,listAssets:listAssets,upload:upload,signedAsset:signedAsset,
    assetsPage:function(search,kind,offset){return rpc('community_assets_page',{p_search:search,p_kind:kind,p_limit:20,p_offset:offset});},
    renameAsset:function(id,name){return rpc('community_rename_asset',{p_asset_id:id,p_name:name});},
    assetReferences:function(id,offset){return rpc('community_asset_references',{p_asset_id:id,p_limit:20,p_offset:offset});},
    deleteAsset:function(id){return removePrivate('community_prepare_asset_delete',{p_asset_id:id});},
    orphans:function(offset){return rpc('community_orphan_assets',{p_limit:20,p_offset:offset});},
    deleteOrphan:function(id){return removePrivate('community_prepare_orphan_delete',{p_object_id:id});},
    submit:function (id) {return rpc('community_submit_revision',{p_revision_id:id});},listReviews:listReviews,
    review:function (id,decision,reason) {auth.requireAdmin();return rpc('community_review_revision',{p_revision_id:id,p_decision:decision,p_rejection_reason:reason||null});},
    policyUser:policyUser,policyStatus:function (id) {auth.requireAdmin();return rpc('community_review_cycle_status',{p_user_id:id});},
    setCycle:function (id,type,n) {auth.requireAdmin();return rpc('community_set_review_cycle',{p_user_id:id,p_content_type:type,p_every:n});},
    setFeatured:function(id,featured){auth.requireAdmin();return rpc('community_set_featured',{p_item_id:id,p_featured:featured});},
    restore:function(id){auth.requireAdmin();return rpc('community_restore_revision',{p_revision_id:id});},
    trash:async function(offset){var db=await client();return value(await db.from('content_revision_trash').select('*,content_revisions!content_revision_trash_revision_id_fkey(title)').is('restored_at',null).order('trashed_at',{ascending:false}).range(offset,offset+19));},
    publishedArticles:async function(offset){var db=await client();auth.requireAdmin();return value(await db.from('content_items').select(itemFields+',content_revisions!content_published_revision_same_item(title)').eq('content_type','article').not('published_revision_id','is',null).order('created_at',{ascending:false}).range(offset,offset+19));},
    siteSettings:async function(){var db=await client();auth.requireAdmin();return value(await db.from('community_site_settings').select('*').eq('source_version',20261013).order('created_at',{ascending:false}).limit(1));},
    assetInfo:async function(id){if(!schema.uuid(id))throw Error('无效资源');var db=await client();return value(await db.from('user_assets').select('id,original_name,mime_type,size_bytes').eq('id',id).maybeSingle());},
    legacyRevision:async function(id){var db=await client();auth.requireAdmin();var item=value(await db.from('content_items').select('published_revision_id').eq('id',id).maybeSingle());if(!item||!item.published_revision_id)throw Error('迁移条目尚未公开');return item;},
    legacyMappings:async function(){var db=await client();auth.requireAdmin();return value(await db.from('community_legacy_mappings').select('item_id,target_type,target_id'));},
    saveSiteSettings:function(settings){auth.requireAdmin();return rpc('community_save_site_settings',{p_settings:settings});}};
})();
