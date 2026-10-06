(function () {
  'use strict';
  var auth=window.BlogAuth,data=window.CommunityData,$=function(id){return document.getElementById(id);};
  var generation=0,offset=0,orphanOffset=0,referenceOffset=0,referenceAsset=null,referenceGeneration=0,timers=[];
  function node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function active(t){return t===generation&&!!auth.user();}
  function status(text){$('assetCenterStatus').textContent=text;}
  function clear(){generation++;referenceGeneration++;offset=0;orphanOffset=0;referenceOffset=0;referenceAsset=null;timers.forEach(clearTimeout);timers=[];
    ['assetCenterList','assetOrphanList','assetReferenceList','assetCenterStatus','communityAssetViewer'].forEach(function(id){$(id).replaceChildren();});$('assetSearch').value='';$('assetKind').value='all';}
  function button(row,text,fn,disabled){var b=node('button',text,'btn');b.type='button';b.disabled=!!disabled;row.appendChild(b);b.addEventListener('click',async function(){var t=generation;b.disabled=true;try{auth.requireUser();await fn(t);}catch(e){if(active(t))status(e.message);}finally{if(active(t))b.disabled=!!disabled;}});}
  async function thumbnail(asset,row,t){try{var result=await data.signedAsset(asset.id);if(!active(t))return;var img=node('img');img.className='asset-thumbnail';img.src=result.url;img.alt=asset.original_name;row.prepend(img);timers.push(setTimeout(function(){img.remove();},Math.max(0,result.expiresAt-Date.now())));}catch(e){if(active(t))row.appendChild(node('p','缩略图暂不可用。'));}}
  async function references(id){referenceAsset=id;var t=generation,attempt=++referenceGeneration;var rows=await data.assetReferences(id,referenceOffset);if(!active(t)||attempt!==referenceGeneration)return;$('assetReferenceList').replaceChildren();
    rows.forEach(function(r){var p=node('p',r.title+' · revision '+r.revision_no+' · '+r.status+(r.is_current_public?' · 当前公开版本':''));var a=node('a','查看版本');a.href='account.html?revision='+encodeURIComponent(r.revision_id)+'#content';a.rel='nofollow';p.appendChild(a);$('assetReferenceList').appendChild(p);});if(!rows.length)$('assetReferenceList').appendChild(node('p','没有 revision 引用。'));$('assetReferencePrev').disabled=referenceOffset===0;$('assetReferenceNext').disabled=rows.length<20;
  }
  async function orphans(t){var rows=await data.orphans(orphanOffset);if(!active(t))return;$('assetOrphanList').replaceChildren();rows.forEach(function(o){var row=node('article',undefined,'public-content-card');row.appendChild(node('p',o.object_path,'public-text'));button(row,'清理此未登记对象',async function(token){await data.deleteOrphan(o.object_id);if(active(token)){orphanOffset=0;await orphans(token);status('未登记对象已通过 Storage API 清理。');}});$('assetOrphanList').appendChild(row);});if(!rows.length)$('assetOrphanList').appendChild(node('p','当前目录没有未登记对象。'));$('assetOrphanPrev').disabled=orphanOffset===0;$('assetOrphanNext').disabled=rows.length<20;}
  async function page(){var t=++generation;$('communityAssetViewer').replaceChildren();timers.forEach(clearTimeout);timers=[];referenceGeneration++;$('assetReferenceList').replaceChildren();referenceAsset=null;$('assetCenterList').replaceChildren();
    try{auth.requireUser();var rows=await data.assetsPage($('assetSearch').value.trim(),$('assetKind').value,offset);if(!active(t))return;
      rows.forEach(function(a){var row=node('article',undefined,'public-content-card');row.appendChild(node('h3',a.original_name));row.appendChild(node('p',a.mime_type+' · '+Math.ceil(a.size_bytes/1024)+' KiB · '+String(a.created_at||'').slice(0,16)+' · '+a.reference_count+' 个 revision 引用'));
        if(/^image\/(jpeg|png|webp)$/.test(a.mime_type))thumbnail(a,row,t);
        var name=node('input');name.type='text';name.maxLength=255;name.value=a.original_name;name.setAttribute('aria-label','资源新名称');row.appendChild(name);
        button(row,'重命名',async function(token){await data.renameAsset(a.id,name.value);if(active(token)){await page();status('资源名称已更新。');}});
        button(row,'查看私有资源',async function(token){var result=await data.signedAsset(a.id);if(!active(token))return;var viewer=$('communityAssetViewer');viewer.replaceChildren();var link=node('a','查看 '+a.original_name);link.href=result.url;link.target='_blank';link.rel='noopener noreferrer nofollow';viewer.appendChild(link);if(a.mime_type==='video/mp4'){var video=node('video');video.controls=true;video.src=result.url;video.style.maxWidth='100%';viewer.appendChild(video);}timers.push(setTimeout(function(){viewer.replaceChildren(node('p','链接已过期，请重新查看。'));},Math.max(0,result.expiresAt-Date.now())));});
        button(row,'选择用于投稿',function(){window.dispatchEvent(new CustomEvent('community-asset-selected',{detail:a}));status('已加入当前投稿资源选择；请先打开文章、动态或图册编辑器。');});
        button(row,'查看引用',async function(){referenceOffset=0;await references(a.id);});
        button(row,Number(a.reference_count)>0?'被引用 · 禁止删除':'删除未引用资源',async function(token){await data.deleteAsset(a.id);if(active(token)){await page();status('资源已通过 Storage API 删除。');}},Number(a.reference_count)>0);
        $('assetCenterList').appendChild(row);
      });if(!rows.length)$('assetCenterList').appendChild(node('p','没有匹配的资源。'));$('assetPrev').disabled=offset===0;$('assetNext').disabled=rows.length<20;
      await orphans(t);
    }catch(e){if(active(t))status(e.message);}
  }
  [['assetRefresh',function(){offset=0;return page();}],['assetPrev',function(){offset=Math.max(0,offset-20);return page();}],['assetNext',function(){offset+=20;return page();}],
  ['assetOrphanPrev',function(){orphanOffset=Math.max(0,orphanOffset-20);return orphans(generation);}],['assetOrphanNext',function(){orphanOffset+=20;return orphans(generation);}],
  ['assetReferencePrev',function(){referenceOffset=Math.max(0,referenceOffset-20);return referenceAsset&&references(referenceAsset);}],['assetReferenceNext',function(){referenceOffset+=20;return referenceAsset&&references(referenceAsset);}]]
  .forEach(function(entry){$(entry[0]).addEventListener('click',async function(){var t=generation;try{auth.requireUser();await entry[1]();}catch(e){if(active(t))status(e.message);}});});
  window.AssetCenter={clear:clear,refresh:page};
})();
