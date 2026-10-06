(function () {
  'use strict';
  var auth=window.BlogAuth, data=window.CommunityData, schema=window.CommunitySchema;
  var $=function(id){return document.getElementById(id);};
  var names={article:'文章',moment:'动态',album:'图册'}, states={draft:'draft · 草稿',pending:'pending · 待审',approved:'published · 已发布',rejected:'rejected · 已驳回'};
  var generation=0, draft=null, preview=null, assets=[], policyTarget=null, timers=[], busy=false, selection=[];
  function node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function message(text,error,id){var el=$(id||'communityStatus');el.textContent=text;el.className='status-line '+(error?'err':'ok');}
  function active(token){return token===generation&&!!auth.user();}
  function button(parent,label,fn){var b=node('button',label,'btn');b.type='button';b.addEventListener('click',function(){operation(fn,b);});parent.appendChild(b);return b;}
  async function operation(fn,control){
    if(busy)return;busy=true;var token=generation;if(control)control.disabled=true;
    try{auth.requireUser();await fn(token);}catch(e){if(active(token))message(e.message,true);}finally{busy=false;if(control)control.disabled=false;}
  }
  function clear(){
    generation++;draft=null;preview=null;assets=[];selection=[];policyTarget=null;busy=false;
    timers.forEach(clearTimeout);timers=[];
    ['communityItems','communityAssets','communityAssetChoices','communityAssetViewer','communityPreviewBody','communityPreviewAssets','communityPreviewActions','communityReviewQueue','communityPolicyRows'].forEach(function(id){$(id).replaceChildren();});
    ['communityTitle','communityText','communitySummary','communityTags','communityRejectReason','communityPolicyUser','communityPolicyThreshold','communityUploadFile'].forEach(function(id){$(id).value='';});
    ['communityStatus','communityAssetStatus','communityPreviewTitle','communityPreviewState','communityPreviewReason','communityPolicyIdentity'].forEach(function(id){$(id).textContent='';});
    $('communityEditor').hidden=true;$('communityPreview').hidden=true;$('communityReviewControls').hidden=true;
  }
  function revisionItem(row){return row.content_items;}
  function renderItems(items){
    $('communityItems').replaceChildren();
    if(!items.length)$('communityItems').appendChild(node('p','还没有投稿。'));
    items.forEach(function(item){
      var row=node('article',undefined,'community-row'), latest=(item.content_revisions||[])[0];
      row.appendChild(node('h3',(latest?latest.title:item.slug)+' · '+names[item.content_type]));
      row.appendChild(node('p',latest?states[latest.status]:'空条目 · 请新建草稿'));
      if(item.published_revision_id&&(!latest||latest.id!==item.published_revision_id))row.appendChild(node('p','已有公开版本仍然可见。'));
      if(latest&&latest.rejection_reason)row.appendChild(node('p','驳回原因：'+latest.rejection_reason));
      if(latest)button(row,'查看版本',function(token){return openRevision(latest.id,token);});
      else button(row,'继续创建草稿',function(){openEditor(item,null);});
      if(item.published_revision_id)button(row,'查看当前发布版本',function(token){return openRevision(item.published_revision_id,token);});
      $('communityItems').appendChild(row);
    });
  }
  function choices(){
    var selected=new Map(selection.map(function(photo){return [photo.asset_id,photo.caption||''];}));
    $('communityAssetChoices').replaceChildren();
    assets.forEach(function(asset){
      if(draft&&draft.item.content_type==='album'&&!/^image\/(jpeg|png|webp)$/.test(asset.mime_type))return;
      var label=node('label',undefined,'community-asset-choice'), check=node('input');check.type='checkbox';check.value=asset.id;check.checked=selected.has(asset.id);check.dataset.assetChoice='';
      label.appendChild(check);label.appendChild(node('span',asset.original_name));
      if(draft&&draft.item.content_type==='album'){var caption=node('input');caption.type='text';caption.maxLength=200;caption.value=selected.get(asset.id)||'';caption.dataset.assetCaption=asset.id;caption.setAttribute('aria-label',asset.original_name+' 图片说明');label.appendChild(caption);}
      $('communityAssetChoices').appendChild(label);
    });
    if(!assets.length)$('communityAssetChoices').appendChild(node('p','请先在“我的资源”上传文件。'));
  }
  function captureChoices(){
    selection=Array.from($('communityAssetChoices').querySelectorAll('[data-asset-choice]:checked')).map(function(el){
      var caption=Array.from($('communityAssetChoices').querySelectorAll('[data-asset-caption]')).find(function(c){return c.dataset.assetCaption===el.value;});
      return {asset_id:el.value,caption:caption?caption.value:''};
    });
  }
  function openEditor(item,row){
    if(item.author_id&&item.author_id!==auth.requireUser().id)throw Error('只能编辑自己的内容。');
    draft={item:item,source:row};preview=null;$('communityPreview').hidden=true;$('communityReviewControls').hidden=true;
    $('communityEditor').hidden=false;var body=row?row.body:{};
    $('communityEditorHeading').textContent='编辑'+names[item.content_type]+'草稿';
    $('communityEditorState').textContent=row?'保存会建立新的不可变草稿版本。':'新内容 · 保存后可继续编辑或提交。';
    $('communityTitle').value=row?row.title:'';$('communityText').value=body.text||body.description||'';
    $('communityText').maxLength=item.content_type==='article'?100000:2000;
    $('communityTextLabel').textContent=item.content_type==='album'?'图册描述（纯文本）':'正文（纯文本）';
    $('communitySummary').value=body.summary||'';$('communityTags').value=(body.tags||[]).join(', ');
    $('communityArticleFields').hidden=item.content_type!=='article';
    $('communityAssetLegend').textContent=item.content_type==='album'?'选择图片并填写说明':'选择我的资源';
    selection=item.content_type==='album'?(body.photos||[]):(body.asset_ids||[]).map(function(id){return{asset_id:id};});
    choices();$('communityTitle').focus();
  }
  function editorBody(){
    var type=draft.item.content_type, selected=Array.from($('communityAssetChoices').querySelectorAll('[data-asset-choice]:checked')).map(function(el){return el.value;});
    var body=type==='album'?{description:$('communityText').value,photos:selected.map(function(id){
      var caption=Array.from($('communityAssetChoices').querySelectorAll('[data-asset-caption]')).find(function(el){return el.dataset.assetCaption===id;});
      return{asset_id:id,caption:caption?caption.value:''};
    })}:{text:$('communityText').value,asset_ids:selected};
    if(type==='article'){body.summary=$('communitySummary').value;body.tags=$('communityTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean);}
    schema.validate(type,$('communityTitle').value,body);return body;
  }
  async function saveEditor(token,submit){
    if(!draft)throw Error('请先打开草稿。');var item=draft.item, title=$('communityTitle').value,body=editorBody();
    var rid=item.id?await data.save(item,title,body):await data.create(item.content_type,'c-'+crypto.randomUUID(),title,body);
    if(!active(token))return;
    // Preserve the successfully saved revision even if submission/network fails.
    var saved=await data.getRevision(rid);if(!active(token))return;
    openEditor(revisionItem(saved),saved);setRevisionUrl(rid);
    message('草稿已保存。');
    if(submit){await data.submit(rid);if(!active(token))return;$('communityEditor').hidden=true;await openRevision(rid,token);message('提交成功，请查看版本状态。');}
    await refreshLists(token);
  }
  function setRevisionUrl(id){var url=new URL(location.href);url.searchParams.set('revision',id);url.hash='content';history.replaceState({},'',url.pathname+url.search+url.hash);}
  async function showAsset(id,container,token,caption){
    var result=await data.signedAsset(id);if(!active(token))return;
    var block=node('div',undefined,'community-asset-preview');
    if(/^image\/(jpeg|png|webp)$/.test(result.asset.mime_type)){var img=node('img');img.src=result.url;img.alt=caption||result.asset.original_name;block.appendChild(img);}
    var link=node('a','查看 '+result.asset.original_name);link.href=result.url;link.target='_blank';link.rel='noopener noreferrer nofollow';block.appendChild(link);
    if(caption)block.appendChild(node('p',caption));container.appendChild(block);
    timers.push(setTimeout(function(){block.replaceChildren(node('p','私有资源链接已过期，请重新预览。'));},Math.max(0,result.expiresAt-Date.now())));
  }
  async function previewRow(row,token){
    var item=revisionItem(row);preview=row;$('communityPreview').hidden=false;$('communityReviewControls').hidden=true;
    $('communityPreviewTitle').textContent=row.title;$('communityPreviewState').textContent=states[row.status]||'文本预览';
    $('communityPreviewReason').textContent=row.rejection_reason?'驳回原因：'+row.rejection_reason:'';
    $('communityPreviewBody').replaceChildren();$('communityPreviewAssets').replaceChildren();$('communityPreviewActions').replaceChildren();$('communityRejectReason').value='';
    var body=row.body;
    // Schema validation and text nodes, never user HTML or body-controlled URLs.
    schema.validate(item.content_type,row.title,body);
    if(body.summary)$('communityPreviewBody').appendChild(node('p',body.summary));
    $('communityPreviewBody').appendChild(node('p',body.text||body.description||''));
    if(body.tags)$('communityPreviewBody').appendChild(node('p','标签：'+body.tags.join('、')));
    if(row.id&&item.author_id===auth.user().id){
      if(row.status==='draft'){button($('communityPreviewActions'),'继续编辑',function(){openEditor(item,row);});button($('communityPreviewActions'),'提交此草稿',async function(t){await data.submit(row.id);if(active(t)){await openRevision(row.id,t);await refreshLists(t);}});}
      if(row.status==='rejected'||row.status==='approved')button($('communityPreviewActions'),row.status==='rejected'?'重新编辑':'修改并建立草稿',async function(t){
        var id=await data.save(item,row.title,row.body);if(active(t)){var next=await data.getRevision(id);if(active(t)){openEditor(item,next);setRevisionUrl(id);message('已从原版本建立新草稿。');await refreshLists(t);}}});
    }
    if(row.id&&row.status==='pending'&&auth.isAdmin())$('communityReviewControls').hidden=false;
    var list=item.content_type==='album'?body.photos:(body.asset_ids||[]).map(function(id){return{asset_id:id};});
    var target=$('communityPreviewAssets');
    for(var photo of list){try{await showAsset(photo.asset_id,target,token,photo.caption);}catch(e){if(active(token))target.appendChild(node('p','资源不可预览：'+e.message));}}
  }
  async function openRevision(id,token){var row=await data.getRevision(id);if(!active(token))return;$('communityEditor').hidden=true;setRevisionUrl(id);await previewRow(row,token);if(active(token)&&$('communityPreview').scrollIntoView)$('communityPreview').scrollIntoView({block:'start'});}
  async function refreshLists(token){
    var rows=await data.listItems();if(!active(token))return;renderItems(rows);
    assets=await data.listAssets();if(!active(token))return;$('communityAssets').replaceChildren();
    assets.forEach(function(asset){var row=node('div',undefined,'community-row');row.appendChild(node('p',asset.original_name+' · '+Math.ceil(asset.size_bytes/1024)+' KiB'));button(row,'查看私有资源',async function(t){$('communityAssetViewer').replaceChildren();await showAsset(asset.id,$('communityAssetViewer'),t);});$('communityAssets').appendChild(row);});
    if(!assets.length)$('communityAssets').appendChild(node('p','暂无私有资源。'));
    if(auth.isAdmin()){var queue=await data.listReviews();if(!active(token)||!auth.isAdmin())return;$('communityReviewQueue').replaceChildren();queue.forEach(function(row){var entry=node('div',undefined,'community-row');entry.appendChild(node('p',row.title+' · '+names[revisionItem(row).content_type]+' · 作者 '+revisionItem(row).author_id));button(entry,'预览与审核',function(t){return openRevision(row.id,t);});$('communityReviewQueue').appendChild(entry);});if(!queue.length)$('communityReviewQueue').appendChild(node('p','暂无待审内容。'));}
  }
  async function refresh(){var token=++generation;try{auth.requireUser();await refreshLists(token);if(!active(token))return;var id=new URLSearchParams(location.search).get('revision');if(id)await openRevision(id,token);}catch(e){if(active(token))message(e.message,true);}}
  async function decision(token,choice){auth.requireAdmin();if(!preview||preview.status!=='pending')throw Error('请先选择待审版本。');var reason=choice==='rejected'?$('communityRejectReason').value.trim():null;if(choice==='rejected'&&!reason)throw Error('拒绝必须填写原因。');var id=preview.id;await data.review(id,choice,reason);if(active(token)){await openRevision(id,token);await refreshLists(token);message('审核决策已保存。');}}
  async function loadPolicy(token){auth.requireAdmin();var target=await data.policyUser($('communityPolicyUser').value.trim());var rows=await data.policyStatus(target.id);if(!active(token)||!auth.isAdmin())return;policyTarget=target;$('communityPolicyIdentity').textContent=target.username+' · '+target.id;$('communityPolicyRows').textContent=rows.map(function(r){return names[r.content_type]+'：'+(r.manual_approvals_required===null?'永远审核':'N='+r.manual_approvals_required)+'，已人工通过新内容 '+r.approved_new_count;}).join('\n');}
  document.querySelectorAll('[data-new-content]').forEach(function(b){b.addEventListener('click',function(){operation(function(){openEditor({content_type:b.dataset.newContent,author_id:auth.requireUser().id},null);},b);});});
  [['communitySave',function(t){return saveEditor(t,false);}],['communitySubmit',function(t){return saveEditor(t,true);}],['communityRefresh',refreshLists],['communityRefreshReviews',refreshLists],
    ['communityTextPreview',function(t){if(!draft)throw Error('请先打开草稿。');return previewRow({title:$('communityTitle').value,body:editorBody(),content_items:draft.item},t);}],
    ['communityApprove',function(t){return decision(t,'approved');}],['communityReject',function(t){return decision(t,'rejected');}],['communityLoadPolicy',loadPolicy],
    ['communitySavePolicy',async function(t){auth.requireAdmin();if(!policyTarget)throw Error('请先查询目标用户。');var raw=$('communityPolicyThreshold').value.trim(),n=raw===''?null:Number(raw);if(n!==null&&(!Number.isInteger(n)||n<0||n>10000))throw Error('阈值须为 0–10000 的整数或留空。');await data.setThreshold(policyTarget.id,$('communityPolicyType').value,n);if(active(t)){await loadPolicy(t);message('用户审核阈值已更新。');}}],
    ['communityUpload',async function(t){var file=$('communityUploadFile').files[0];if(!file)throw Error('请选择文件。');if(draft)captureChoices();message('正在上传…',false,'communityAssetStatus');await data.upload(file);if(active(t)){message('私有资源已上传。',false,'communityAssetStatus');$('communityUploadFile').value='';await refreshLists(t);if(active(t)&&draft)choices();}}]
  ].forEach(function(entry){$(entry[0]).addEventListener('click',function(){operation(entry[1],$(entry[0]));});});
  $('communityCloseEditor').addEventListener('click',function(){$('communityEditor').hidden=true;draft=null;});
  window.addEventListener('popstate',function(){if(auth.user())refresh();});
  window.CommunityUI={clear:clear,refresh:refresh};
})();
