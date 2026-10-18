/* One main-style resource card for the library and editor picker. Supabase only. */
(function(){
 'use strict';
 function Resource_Node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 function Resource_CreateCard(asset,options){
  var card=Resource_Node('article',undefined,'rm-item'),thumb=Resource_Node('div',undefined,'rm-thumb'),info=Resource_Node('div',undefined,'rm-info'),actions=Resource_Node('div',undefined,'rm-actions');
  card.dataset.assetId=asset.id;thumb.appendChild(Resource_Node('span',asset.mime_type==='video/mp4'?'▶':'📄','rm-icon'));
  info.appendChild(Resource_Node('strong',asset.original_name));info.appendChild(Resource_Node('span',asset.mime_type+' · '+Math.ceil(asset.size_bytes/1024)+' KiB'));info.appendChild(Resource_Node('span',(asset.reference_count||0)+' 个历史版本引用'));
  card.append(thumb,info,actions);
  function Resource_AddAction(text,fn,disabled){var b=Resource_Node('button',text,'btn');b.type='button';b.disabled=!!disabled;actions.appendChild(b);b.addEventListener('click',async function(){b.disabled=true;try{if(options.active())await fn();}catch(e){if(options.active())options.status(e.message);}finally{if(options.active())b.disabled=!!disabled;}});return b;}
  if(options.select)Resource_AddAction('选择并返回',function(){return options.select(asset);});
  if(options.manage){
   Resource_AddAction('重命名',async function(){var name=window.prompt('资源新名称：',asset.original_name);if(name===null)return;await window.CommunityData.renameAsset(asset.id,name);if(options.active())await options.refresh();});
   Resource_AddAction('复制临时链接',async function(){var result=await window.CommunityData.signedAsset(asset.id);if(!options.active())return;await navigator.clipboard.writeText(result.url);if(options.active())options.status('已复制私有链接；60 秒后失效。请勿用于公开页面。');});
   Resource_AddAction('查看引用',function(){return options.references(asset.id);});
   Resource_AddAction(Number(asset.reference_count)>0?'被引用 · 禁止删除':'删除',async function(){if(!window.confirm('删除未引用资源 '+asset.original_name+'？'))return;await window.CommunityData.deleteAsset(asset.id);if(options.active())await options.refresh();},Number(asset.reference_count)>0);
  }
  if(options.preview)Resource_AddAction('预览',async function(){if(!options.manage)return options.preview(asset);var result=await window.CommunityData.signedAsset(asset.id);if(options.active())options.preview(result);});
  if(/^image\/(jpeg|png|webp)$/.test(asset.mime_type))window.CommunityData.signedAsset(asset.id).then(function(s){if(!options.active()||!card.isConnected)return;var img=Resource_Node('img');img.alt=asset.original_name;img.src=s.url;thumb.replaceChildren(img);options.timer(setTimeout(function(){img.removeAttribute('src');thumb.replaceChildren(Resource_Node('span','预览已过期'));},Math.max(0,s.expiresAt-Date.now())));}).catch(function(){/* Retryable preview errors are exposed by the preview action. */});
  return card;
 }
 function Resource_PreviewInline(block,asset,active,timer){
  window.CommunityData.signedAsset(asset.id).then(function(s){if(!active()||!block.isConnected)return;var media;
   if(/^image\//.test(asset.mime_type)){media=Resource_Node('img');media.alt=asset.original_name;}
   else if(asset.mime_type==='video/mp4'){media=Resource_Node('video');media.controls=true;media.preload='metadata';}
   else{media=Resource_Node('a',asset.original_name);media.href=s.url;media.target='_blank';media.rel='noopener noreferrer nofollow';}
   if(media.tagName!=='A')media.src=s.url;block.replaceChildren(media,Resource_Node('span',asset.original_name));
   timer(setTimeout(function(){media.removeAttribute('src');media.removeAttribute('href');block.replaceChildren(Resource_Node('span',asset.original_name+' · 预览已过期，重新打开可刷新'));},Math.max(0,s.expiresAt-Date.now())));
  }).catch(function(e){if(active()&&block.isConnected)block.textContent=asset.original_name+' · '+e.message;});
 }
 function Resource_CreatePicker(options){
  var el=options.elements,auth=window.BlogAuth,attempt=0,offset=0,identity=null,context=null,timers=[],uploading=false,uploadAttempt=0,previewSerial=0,returnFocus=null,request={},uploadAccept=el.upload.accept;
  function Resource_Accept(mime){return (!options.accept||options.accept(mime))&&(!request.imageOnly||/^image\/(jpeg|png|webp)$/.test(mime));}
  function Resource_ClearTimers(){timers.forEach(clearTimeout);timers=[];}
  function Resource_Active(token){return token===attempt&&el.dialog.open&&auth.user()&&auth.user().id===identity&&(!options.active||options.active(context));}
  function Resource_Clear(){attempt++;uploadAttempt++;identity=null;uploading=false;offset=0;Resource_ClearTimers();el.list.replaceChildren();el.preview.replaceChildren();el.status.textContent='';el.upload.value='';el.search.value='';el.kind.value=options.defaultKind||'all';if(el.dialog.open)el.dialog.close();}
  function Resource_Close(){Resource_Clear();if(returnFocus&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});}
  async function Resource_Load(){
   var token=++attempt;Resource_ClearTimers();el.list.replaceChildren();el.preview.replaceChildren();el.status.textContent='正在读取我的资源…';el.prev.disabled=el.next.disabled=true;
   try{
    auth.requireUser();var kind=el.kind.value,search=el.search.value.trim(),rows=[],sourceOffset=0,hasNext=false;
    // The existing RPC has no combined media kind. Filter before pagination, including lookahead.
    if(options.mediaOnly&&kind==='all'){
     while(rows.length<=offset+20){var source=await window.CommunityData.assetsPage(search,'all',sourceOffset);if(!Resource_Active(token))return;rows=rows.concat(source.filter(function(a){return /^(image\/(jpeg|png|webp)|video\/mp4)$/.test(a.mime_type);}));if(source.length<20)break;sourceOffset+=20;}
     hasNext=rows.length>offset+20;rows=rows.slice(offset,offset+20);
    }else{rows=await window.CommunityData.assetsPage(search,kind,offset);if(!Resource_Active(token))return;if(rows.length===20){var peek=await window.CommunityData.assetsPage(search,kind,offset+20);if(!Resource_Active(token))return;hasNext=peek.length>0;}}
    rows.filter(function(a){return Resource_Accept(a.mime_type);}).forEach(function(asset){
     el.list.appendChild(Resource_CreateCard(asset,{active:function(){return Resource_Active(token);},timer:function(t){timers.push(t);},status:function(text){el.status.textContent=text;},select:async function(a){if(!Resource_Active(token)||!Resource_Accept(a.mime_type))return;await (request.select||options.select)(a);if(Resource_Active(token))Resource_Close();},preview:function(a){var serial=++previewSerial;el.preview.replaceChildren();Resource_PreviewInline(el.preview,a,function(){return Resource_Active(token)&&serial===previewSerial;},function(t){timers.push(t);});}}));
    });
    el.prev.disabled=offset===0;el.next.disabled=!hasNext;if(el.page)el.page.textContent='第 '+(offset/20+1)+' 页';el.status.textContent=rows.length?'':'没有匹配的资源，可上传新文件。';
   }catch(error){if(Resource_Active(token))el.status.textContent=error.message;}
  }
  function Resource_Refresh(){offset=0;Resource_Load();}
  el.refresh.addEventListener('click',Resource_Refresh);el.kind.addEventListener('change',Resource_Refresh);el.search.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();Resource_Refresh();}});
  el.prev.addEventListener('click',function(){offset=Math.max(0,offset-20);Resource_Load();});el.next.addEventListener('click',function(){offset+=20;Resource_Load();});
  el.close.addEventListener('click',Resource_Close);el.dialog.addEventListener('cancel',function(e){e.preventDefault();Resource_Close();});el.dialog.addEventListener('close',function(){if(!el.dialog.open&&identity)Resource_Clear();});
  el.upload.closest('label').addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();el.upload.click();}});
  el.upload.addEventListener('change',async function(){var files=Array.from(this.files);this.value='';if(uploading||!files.length)return;var token=attempt,uploadToken=++uploadAttempt;uploading=true;el.upload.disabled=true;
   try{for(var file of files){if(!Resource_Active(token))return;if(!Resource_Accept(file.type))throw Error('此编辑器不支持该文件类型。');el.status.textContent='正在上传…';var id=await window.CommunityData.upload(file);if(!Resource_Active(token))return;if(options.uploaded)await options.uploaded({id:id,original_name:file.name,mime_type:file.type});if(!Resource_Active(token))return;}offset=0;await Resource_Load();}
   catch(error){if(Resource_Active(token))el.status.textContent=error.message;}finally{if(uploadToken===uploadAttempt){uploading=false;el.upload.disabled=false;}}
  });
  document.addEventListener('blog-auth-change',Resource_Clear);
  return {open:function(kind,mode){auth.requireUser();Resource_Clear();request=mode||{};identity=auth.user().id;context=options.context?options.context():null;returnFocus=document.activeElement;el.kind.value=request.imageOnly?'image':typeof kind==='string'?kind:options.defaultKind||'all';if(!el.kind.value)el.kind.value=options.defaultKind||'all';el.kind.disabled=!!request.imageOnly;el.upload.accept=request.imageOnly?'image/jpeg,image/png,image/webp':uploadAccept;el.upload.disabled=false;el.dialog.showModal();Resource_Load();},close:Resource_Close,clear:Resource_Clear};
 }
 window.ResourceManager={card:Resource_CreateCard,previewInline:Resource_PreviewInline,picker:Resource_CreatePicker};
})();
