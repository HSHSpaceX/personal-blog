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
   Resource_AddAction('预览',async function(){var result=await window.CommunityData.signedAsset(asset.id);if(options.active())options.preview(result);});
   Resource_AddAction('查看引用',function(){return options.references(asset.id);});
   Resource_AddAction(Number(asset.reference_count)>0?'被引用 · 禁止删除':'删除',async function(){if(!window.confirm('删除未引用资源 '+asset.original_name+'？'))return;await window.CommunityData.deleteAsset(asset.id);if(options.active())await options.refresh();},Number(asset.reference_count)>0);
  }
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
 window.ResourceManager={card:Resource_CreateCard,previewInline:Resource_PreviewInline};
})();
