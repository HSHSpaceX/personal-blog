(function(){
 'use strict';
 var root=document.getElementById('reviewWorkspace');if(!root)return;
 var auth=window.BlogAuth,data=window.CommunityData,schema=window.CommunitySchema,offset=0,generation=0,selected=null,busy=false,detailSerial=0;
 var $=function(id){return document.getElementById('review'+id);};
 function Review_Node(tag,text){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
 function Review_Active(t){return t===generation&&auth.user()&&auth.isAdmin();}
 async function Review_RPC(name,args){auth.requireAdmin();var r=await auth.client().rpc(name,args);if(r.error)throw Error(data.errorMessage(r.error));return r.data;}
 function Review_Status(text){$('Status').textContent=text;}
 async function Review_Load(){var t=++generation;try{var rows=await Review_RPC('community_review_queue',{p_type:$('Type').value,p_status:$('Filter').value,p_search:$('Search').value,p_newest:$('Sort').value==='newest',p_limit:20,p_offset:offset});if(!Review_Active(t))return;$('Queue').replaceChildren();rows.forEach(function(r){var b=Review_Node('button');b.type='button';b.className='review-entry';b.append(Review_Node('strong',r.title),Review_Node('span',(r.author.display_name||r.author.username||r.author_id)+' · '+r.type+' · '+(r.is_edit?'修改':'新发布')),Review_Node('time',r.submitted||''));b.onclick=function(){Review_Show(r,t);};$('Queue').appendChild(b);});$('Prev').disabled=offset===0;$('Next').disabled=rows.length<20;$('Page').textContent='第 '+(offset/20+1)+' 页';if(!rows.length)$('Queue').appendChild(Review_Node('p','此筛选下暂无内容。'));Review_Status('');}catch(e){if(Review_Active(t))Review_Status(e.message);}}
 async function Review_Body(body,type,target,t,serial){target.replaceChildren();var refs=(body.asset_ids||[]).concat((body.photos||[]).map(function(p){return p.asset_id;}));if(body.document)target.innerHTML=schema.renderDocument(body.document,refs,type==='article'?100000:2000);else target.appendChild(Review_Node('p',body.text||body.description||''));for(var id of refs){try{var asset=await data.signedAsset(id);if(!Review_Active(t)||serial!==detailSerial)return;var n=Review_Node(asset.asset.mime_type.startsWith('image/')?'img':asset.asset.mime_type==='video/mp4'?'video':'a');if(n.tagName==='A'){n.href=asset.url;n.textContent=asset.asset.original_name;n.rel='noopener noreferrer';n.target='_blank';}else {n.src=asset.url;n.alt=asset.asset.original_name;if(n.tagName==='VIDEO'){n.controls=true;n.playsInline=true;}}target.appendChild(n);setTimeout(function(){if(n.isConnected)n.replaceWith(Review_Node('p','媒体预览过期，请重新选择版本。'));},Math.max(0,asset.expiresAt-Date.now()));}catch(e){if(Review_Active(t)&&serial===detailSerial)target.appendChild(Review_Node('p','媒体读取失败：'+e.message));}}}
 async function Review_Show(row,t){if(busy)return;var serial=++detailSerial;selected=row;$('Detail').hidden=false;root.classList.add('has-detail');$('Title').textContent=row.title;$('Meta').textContent=(row.author.display_name||row.author.username||'已注销用户')+' · '+row.type+' · '+(row.is_edit?'修改已发布版本':'首次发布')+(row.review_due?' · 周期必审关口':'')+' · '+row.status;$('Reason').value='';$('Decisions').hidden=row.status!=='pending';$('Restore').hidden=row.status!=='trashed';try{await Review_Body(row.body,row.type,$('Body'),t,serial);if(!Review_Active(t)||serial!==detailSerial)return;$('Previous').hidden=!Object.keys(row.previous_body||{}).length;if(!$('Previous').hidden)await Review_Body(row.previous_body,row.type,$('PreviousBody'),t,serial);}catch(e){Review_Status(e.message);}if(innerWidth<=700)$('Detail').scrollIntoView({block:'start'});}
 async function Review_Decide(choice){if(busy||!selected)return;var row=selected,t=generation,reason=choice==='approved'?null:$('Reason').value.trim();if(choice!=='approved'&&!reason){Review_Status('退回或拒绝必须填写原因。');$('Reason').focus();return;}busy=true;$('Decisions').querySelectorAll('button').forEach(function(b){b.disabled=true;});try{await window.BackendCapabilities.requireUpgrade();if(!Review_Active(t))return;await Review_RPC('community_review_entry',{p_kind:row.kind,p_id:row.id,p_decision:choice,p_reason:reason,p_expected:row.kind==='comment'?row.body.text:null});if(!Review_Active(t))return;selected=null;$('Detail').hidden=true;root.classList.remove('has-detail');await Review_Load();Review_Status('决策已保存。批准内容仍需服务器同步和部署。');document.dispatchEvent(new Event('blog-review-change'));document.dispatchEvent(new Event('blog-messages-change'));}catch(e){if(Review_Active(t))Review_Status(e.message);}finally{busy=false;$('Decisions').querySelectorAll('button').forEach(function(b){b.disabled=false;});}}
 ['approved','returned','trashed'].forEach(function(choice){document.querySelector('[data-review-decision="'+choice+'"]').onclick=function(){Review_Decide(choice);};});
 $('Restore').onclick=async function(){if(busy||!selected)return;busy=true;var t=generation,r=selected;try{await window.BackendCapabilities.requireUpgrade();if(r.kind==='content')await data.restore(r.id);else await Review_RPC('community_restore_comment',{p_kind:r.kind,p_id:r.id});if(Review_Active(t)){await Review_Load();$('Detail').hidden=true;Review_Status('已允许作者重新编辑投稿。');}}catch(e){Review_Status(e.message);}finally{busy=false;}};
 $('Back').onclick=function(){root.classList.remove('has-detail');$('Detail').hidden=true;};$('Refresh').onclick=function(){offset=0;Review_Load();};$('Prev').onclick=function(){offset=Math.max(0,offset-20);Review_Load();};$('Next').onclick=function(){offset+=20;Review_Load();};
 window.addEventListener('workspace-route-change',function(e){if(e.detail.route==='review-center'){Review_Load();Deletion_Load();}});document.addEventListener('blog-auth-change',function(){generation++;selected=null;busy=false;$('Queue').replaceChildren();$('Body').replaceChildren();$('PreviousBody').replaceChildren();$('Detail').hidden=true;Review_Status('');Deletion_Reset();});
 /* ---- 删除申请：已发布的文章/图册由站长审核后移除 ---- */
 var deletionOffset=0,deletionSerial=0,deletionBusy=false,selectedDeletion=null;
 function Deletion_Get(id){return document.getElementById(id);}
 function Deletion_Active(t){return t===generation&&auth.user()&&auth.isAdmin();}
 function Deletion_Reset(){deletionOffset=0;selectedDeletion=null;deletionBusy=false;['deletionList','deletionMeta','deletionReason','deletionRejectReason'].forEach(function(id){var el=Deletion_Get(id);if(el)el.replaceChildren();});Deletion_Get('deletionDetail').hidden=true;var status=Deletion_Get('deletionLoadStatus');if(status)status.textContent='';}
 async function Deletion_Load(){
  var t=++deletionSerial,gen=generation;
  function fresh(){return t===deletionSerial&&generation===gen&&auth.user()&&auth.isAdmin();}
  try{
   var rows=await Review_RPC('community_deletion_requests',{p_status:Deletion_Get('deletionFilter').value,p_limit:20,p_offset:deletionOffset});
   if(!Array.isArray(rows))rows=[];
   if(!fresh())return;
   var list=Deletion_Get('deletionList');list.replaceChildren();
   var labels={article:'文章',moment:'动态',album:'图册'},statusLabels={pending:'待审',approved:'已批准',rejected:'已退回'};
   rows.forEach(function(r){
    var entry=Review_Node('button');entry.type='button';entry.className='review-entry';
    entry.append(Review_Node('strong',(r.author&&(r.author.display_name||r.author.username)||'已注销用户')+' · '+(labels[r.content_type]||r.content_type)+' · 删除申请 · '+(statusLabels[r.status]||r.status)),
     Review_Node('span',(r.latest_public_title||r.draft_title||r.slug||'未命名')),
     Review_Node('time',r.created_at||''));
    entry.onclick=function(){Deletion_Show(r);};
    list.appendChild(entry);
   });
   Deletion_Get('deletionPrev').disabled=deletionOffset===0;
   Deletion_Get('deletionNext').disabled=rows.length<20;
   Deletion_Get('deletionPage').textContent='第 '+(deletionOffset/20+1)+' 页';
   if(!rows.length)list.appendChild(Review_Node('p','此筛选下暂无删除申请。'));
   Deletion_Get('deletionLoadStatus').textContent='';
  }catch(e){if(fresh())Deletion_Get('deletionLoadStatus').textContent=e.message;}
 }
 function Deletion_Show(row){
  if(busy)return;
  selectedDeletion=row;
  var statusLabels={pending:'待审',approved:'已批准',rejected:'已退回'};
  Deletion_Get('deletionMeta').textContent=(row.author&&(row.author.display_name||row.author.username)||'已注销用户')+' · '+(row.content_type==='article'?'文章':'图册')+' · '+(statusLabels[row.status]||row.status)+' · '+(row.created_at||'');
  if(row.item_deleted)Deletion_Get('deletionMeta').textContent+=' · 内容已删除（记录保留）';
  Deletion_Get('deletionReason').replaceChildren(Review_Node('p',row.reason?('作者原因：'+row.reason):'作者未填写原因'));
  if(row.status==='rejected')Deletion_Get('deletionReason').appendChild(Review_Node('p','退回原因：'+(row.decision_reason||'')));
  var actions=Deletion_Get('deletionActions');actions.replaceChildren();
  if(row.status==='pending'){
   var approve=Review_Node('button','批准删除');approve.className='btn primary';approve.type='button';
   var reject=Review_Node('button','退回申请');reject.className='btn';reject.type='button';
   actions.appendChild(approve);actions.appendChild(reject);
  }else{
   actions.appendChild(Review_Node('p','此申请已处理。'));
  }
  Deletion_Get('deletionRejectReason').value='';
  Deletion_Get('deletionDetail').hidden=false;
  if(innerWidth<=700)Deletion_Get('deletionDetail').scrollIntoView({block:'start'});
 }
 async function Deletion_Decide(choice){
  if(deletionBusy||!selectedDeletion)return;
  var row=selectedDeletion,t=generation;
  if(choice==='approved'&&!window.confirm('批准删除？公开内容将在服务器同步和部署后移除，历史数据保留用于恢复。'))return;
  var reason=null;
  if(choice==='rejected'){reason=Deletion_Get('deletionRejectReason').value.trim();if(reason.length<1||reason.length>2000){Deletion_Get('deletionLoadStatus').textContent='退回申请必须填写原因（1–2000 字符）。';return;}}
  deletionBusy=true;Deletion_Get('deletionActions').querySelectorAll('button').forEach(function(b){b.disabled=true;});
  try{
   await window.BackendCapabilities.requireUpgrade();
   if(!Deletion_Active(t))return;
   await Review_RPC('community_review_deletion',{p_request_id:row.id,p_decision:choice,p_rejection_reason:reason});
   if(!Deletion_Active(t))return;
   selectedDeletion=null;deletionOffset=0;Deletion_Get('deletionDetail').hidden=true;
   await Deletion_Load();
   Deletion_Get('deletionLoadStatus').textContent='决策已保存。'+(choice==='approved'?'批准的内容仍需服务器同步和部署。':'作者可修改后重新申请。');
   document.dispatchEvent(new Event('blog-review-change'));
   document.dispatchEvent(new Event('blog-messages-change'));
  }catch(e){if(Deletion_Active(t))Deletion_Get('deletionLoadStatus').textContent=e.message;}
  finally{deletionBusy=false;Deletion_Get('deletionActions').querySelectorAll('button').forEach(function(b){b.disabled=false;});}
 }
 Deletion_Get('deletionRefresh').onclick=function(){deletionOffset=0;Deletion_Load();};
 Deletion_Get('deletionPrev').onclick=function(){deletionOffset=Math.max(0,deletionOffset-20);Deletion_Load();};
 Deletion_Get('deletionNext').onclick=function(){deletionOffset+=20;Deletion_Load();};
 Deletion_Get('deletionBack').onclick=function(){selectedDeletion=null;Deletion_Get('deletionDetail').hidden=true;};
 Deletion_Get('deletionActions').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;Deletion_Decide(b.textContent==='批准删除'?'approved':'rejected');});
})();
