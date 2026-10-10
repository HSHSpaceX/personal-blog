(function () {
  'use strict';
  var auth = window.BlogAuth, schema = window.CommunitySchema;
  var itemFields = 'id,author_id,content_type,slug,published_revision_id';
  var revisionFields = '*,content_items!content_revisions_item_id_fkey(' + itemFields + ')';
  function Community_FormatError(error) { return error && (['PGRST202','PGRST205','42883','42P01'].includes(error.code) || /Could not find (?:the function|the table).*schema cache/i.test(error.message||'')) ? '当前连接的 Supabase 环境尚未部署所需表或 RPC。请站长核对项目配置、按顺序执行 migrations 并刷新 schema cache；此操作未完成。' : error.message; }
  function value(result) { if (result.error) { var error=new Error(Community_FormatError(result.error));error.code=result.error.code;throw error; } return result.data; }
  async function client() { await auth.ready(); auth.requireUser(); return auth.client(); }
  async function rpc(name, args) { return value(await (await client()).rpc(name, args)); }
  async function listItems() {
    var db = await client();
    return value(await db.from('content_items').select(itemFields+',community_publication_state(status,last_error,published_revision_id),content_revisions!content_revisions_item_id_fkey(id,title,status,rejection_reason,revision_no)')
      .eq('author_id',auth.user().id).order('created_at',{ascending:false}).limit(50)
      .order('revision_no',{referencedTable:'content_revisions',ascending:false}).limit(1,{referencedTable:'content_revisions'}));
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
    var id = await rpc('community_create_item',{p_content_type:type,p_slug:slug});
    return save({id:id,content_type:type},title,body);
  }
  async function listAssets() {
    return rpc('community_assets_page',{p_search:'',p_kind:'all',p_limit:20,p_offset:0});
  }
  async function upload(file) {
    var db = await client(), actor = auth.requireUser().id;
    if (!schema.mime[file.type] || file.size < 1 || file.size > 20*1024*1024) throw Error('支持 JPG/PNG/WebP/MP4/PDF/TXT，文件须为 1 字节至 20 MiB。');
    var path = actor + '/' + crypto.randomUUID() + '.' + schema.mime[file.type];
    value(await db.storage.from('community-assets').upload(path,file,{contentType:file.type,upsert:false}));
    // Recheck identity before registration. If interrupted, retain the exact path
    // for safe orphan cleanup; never register or remove another account's file.
    if (!auth.user() || auth.user().id !== actor) throw Error('账号已变化；未登记的上传留待资源清理。');
    try { return value(await db.rpc('community_register_asset',{p_object_path:path,p_original_name:file.name})); }
    catch (error) {
      if (auth.user() && auth.user().id === actor) {
        var cleanup = await db.storage.from('community-assets').remove([path]);
        if (cleanup.error) throw Error('资源登记失败且清理未完成：'+error.message+'；对象路径：'+path);
      }
      throw error;
    }
  }
  async function signedAsset(id) {
    var db=await client();
    var asset=value(await db.from('user_assets').select('id,original_name,mime_type,object_path').eq('id',id).maybeSingle());
    if (!asset) throw Error('资源不可访问。');
    var result=value(await db.storage.from('community-assets').createSignedUrl(asset.object_path,60));
    var url=new URL(result.signedUrl), origin=new URL(window.BlogConfig.SUPABASE_URL);
    if (url.protocol!=='https:' || url.origin!==origin.origin) throw Error('无效资源地址。');
    return {asset:asset,url:url.href,expiresAt:Date.now()+60000};
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
    var db=await client(),actor=auth.requireUser().id;
    var path=value(await db.rpc(name,args));
    if(!auth.user()||auth.user().id!==actor)throw Error('账号已变化；删除已取消。');
    if(typeof path!=='string'||path.split('/')[0]!==actor||path.split('/').some(function(p){return p==='.'||p==='..';}))throw Error('无效资源路径。');
    value(await db.storage.from('community-assets').remove([path]));
  }
  window.CommunityData = {errorMessage:Community_FormatError,listItems:listItems,getRevision:getRevision,save:save,create:create,listAssets:listAssets,upload:upload,signedAsset:signedAsset,
    assetsPage:function(search,kind,offset){return rpc('community_assets_page',{p_search:search,p_kind:kind,p_limit:20,p_offset:offset});},
    renameAsset:function(id,name){return rpc('community_rename_asset',{p_asset_id:id,p_name:name});},
    assetReferences:function(id,offset){return rpc('community_asset_references',{p_asset_id:id,p_limit:20,p_offset:offset});},
    deleteAsset:function(id){return removePrivate('community_prepare_asset_delete',{p_asset_id:id});},
    orphans:function(offset){return rpc('community_orphan_assets',{p_limit:20,p_offset:offset});},
    deleteOrphan:function(id){return removePrivate('community_prepare_orphan_delete',{p_object_id:id});},
    submit:function (id) {return rpc('community_submit_revision',{p_revision_id:id});},listReviews:listReviews,
    review:function (id,decision,reason) {auth.requireAdmin();return rpc('community_review_revision',{p_revision_id:id,p_decision:decision,p_rejection_reason:reason||null});},
    policyUser:policyUser,policyStatus:function (id) {auth.requireAdmin();return rpc('community_review_policy_status',{p_user_id:id});},
    setThreshold:function (id,type,n) {auth.requireAdmin();return rpc('community_set_user_review_threshold',{p_user_id:id,p_content_type:type,p_threshold:n});}};
})();
