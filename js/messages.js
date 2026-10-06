(function () {
  'use strict';
  var auth=window.BlogAuth, data=window.MessageData, blog=window.BlogData, cards=window.PublicCards;
  var $=function(id){return document.getElementById(id);};
  var generation=0,identity=null,notificationSerial=0,threadsSerial=0,threadSerial=0,historySerial=0,assetSerial=0,countSerial=0;
  var notificationOffset=0,threadsOffset=0,assetOffset=0,orphanOffset=0,selectedThread=null;
  var history=new Map(),attachments=[],imageTimers=[],uploading=0,sending=false,oldest=null;
  window.BlogTheme.setup();
  function node(tag,text,cls){return cards.node(tag,text,cls);}
  function active(token){return token===generation&&auth.user()&&auth.user().id===identity;}
  function chatActive(token,serial){return active(token)&&serial===threadSerial;}
  function status(text,chat){$(chat?'dmChatStatus':'messagesStatus').textContent=text||'';}
  function button(parent,label,fn){
    var b=node('button',label,'btn');b.type='button';parent.appendChild(b);
    b.addEventListener('click',async function(){var token=generation;b.disabled=true;
      try{if(active(token))await fn(token);}catch(e){if(active(token))status(e.message);}finally{b.disabled=false;}
    });return b;
  }
  function clearImages(){imageTimers.forEach(clearTimeout);imageTimers=[];}
  function clearChat(){
    threadSerial++;historySerial++;selectedThread=null;history.clear();oldest=null;attachments=[];uploading=0;sending=false;
    clearImages();['dmHistory','dmPeer','dmChatStatus','dmAttachments'].forEach(function(id){$(id).replaceChildren();});
    $('dmBody').value='';$('dmImages').value='';$('dmSend').disabled=false;$('dmChat').hidden=true;$('dmComposer').hidden=false;
  }
  function clear(){
    generation++;notificationSerial++;threadsSerial++;assetSerial++;countSerial++;identity=null;clearChat();
    notificationOffset=threadsOffset=assetOffset=orphanOffset=0;
    ['messagesList','dmThreads','dmUnsent','dmOrphans','messagesStatus','notificationPage'].forEach(function(id){$(id).replaceChildren();});
    $('notificationUnread').textContent='0';$('dmUnread').textContent='0';$('messagePanels').hidden=true;
  }
  function changed(){document.dispatchEvent(new CustomEvent('blog-messages-change'));}
  async function counts(token){
    var serial=++countSerial,values=await Promise.all([blog.notificationCount(),data.unread()]);
    if(!active(token)||serial!==countSerial)return;
    $('notificationUnread').textContent=String(values[0]);$('dmUnread').textContent=String(values[1]);changed();
  }
  function action(item){
    if(/^content_(approved|rejected)$/.test(item.type)&&data.uuid(item.revision_id))return ['account.html?revision='+item.revision_id+'#content',item.type==='content_rejected'?'查看原因并重新编辑':'查看发布版本'];
    if(/^comment_edit_(approved|rejected)$/.test(item.type)&&data.uuid(item.comment_edit_id))return ['account.html?edit='+item.comment_edit_id+'#my-comments','查看评论修改 / 重新编辑'];
    if(/^comment_(approved|rejected)$/.test(item.type)&&data.uuid(item.comment_id))return ['account.html?comment='+item.comment_id+'#my-comments','查看我的评论 / 重新编辑'];
    if(item.type==='direct_message'&&data.uuid(item.dm_thread_id))return ['messages.html?thread='+item.dm_thread_id+'&tab=dm','打开私信'];
    if(item.type==='follow'&&data.uuid(item.target_id))return ['profile.html?id='+item.target_id,'查看主页'];
    if(!['content_like','comment_like','content_comment','comment_reply'].includes(item.type))return null;
    var id=item.target_id;
    if(item.target_type==='content'&&data.uuid(id)){
      if(item.target_kind==='article'&&/^[a-z0-9][a-z0-9-]{0,159}$/.test(item.target_slug||''))return ['posts/'+item.target_slug+'.html','查看文章'];
      if(item.target_kind==='moment')return ['moments.html#community-'+id,'查看动态'];
      if(item.target_kind==='album')return ['gallery.html?community='+id,'查看图册'];return null;}
    if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id||''))return null;
    if(item.target_type==='post')return [id==='about'?'about.html#commentsSection':'posts/'+encodeURIComponent(id)+'.html#commentsSection','查看文章'];
    if(item.target_type==='moment')return ['moments.html#moment-'+encodeURIComponent(id),'查看动态'];
    if(item.target_type==='album')return ['gallery.html?album='+encodeURIComponent(id),'查看图册'];return null;
  }
  function notificationCard(item){
    var row=node('article',undefined,'comment-item message-item'+(item.read?'':' unread'));
    if(item.actorUsername)row.appendChild(cards.author({username:item.actorUsername,display_name:item.actorName,avatar_url:item.actorAvatar}));else row.appendChild(node('strong','系统'));
    row.appendChild(node('p',(item.created_at||'').slice(0,16).replace('T',' '),'muted'));
    row.appendChild(node('p',item.title,'public-text'));if(item.body)row.appendChild(node('p',item.body,'public-text'));
    var route=action(item);
    if(route){var link=node('a',route[1],'btn');link.href=route[0];link.rel='nofollow';row.appendChild(link);
      link.addEventListener('click',async function(event){event.preventDefault();var token=generation;
        try{await blog.markNotificationsRead(item.id);if(active(token))location.assign(route[0]);}catch(e){if(active(token))status(e.message);}
      });
    }
    if(!item.read)button(row,'标为已读',async function(token){await blog.markNotificationsRead(item.id);if(active(token)){await notifications(token);await counts(token);}});
    return row;
  }
  async function notifications(token){
    var serial=++notificationSerial;$('messagesList').replaceChildren();var rows=await blog.listNotifications(notificationOffset,20);
    if(!active(token)||serial!==notificationSerial)return;
    rows.forEach(function(row){$('messagesList').appendChild(notificationCard(row));});
    if(!rows.length)$('messagesList').appendChild(node('p','还没有通知。'));
    $('notificationPrev').disabled=notificationOffset===0;$('notificationNext').disabled=rows.length<20;$('notificationPage').textContent='第 '+(notificationOffset/20+1)+' 页';
  }
  async function threads(token){
    var serial=++threadsSerial;$('dmThreads').replaceChildren();var rows=await data.threads(threadsOffset);if(!active(token)||serial!==threadsSerial)return;
    rows.forEach(function(t){var row=node('article',undefined,'dm-thread');row.appendChild(cards.author(t));row.appendChild(node('p',(t.last_message_at||'').slice(0,16).replace('T',' ')||'尚无消息','muted'));
      row.appendChild(node('p',t.unread_count+' 条未读'));button(row,'打开会话',function(){return openThread(t.id);});$('dmThreads').appendChild(row);
    });
    if(!rows.length)$('dmThreads').appendChild(node('p','还没有会话。从对方主页点击“私信”开始。'));
    $('dmThreadsPrev').disabled=threadsOffset===0;$('dmThreadsNext').disabled=rows.length<20;
  }
  async function image(parent,asset,token,serial){
    var caption=node('span','图片加载中…','muted');parent.appendChild(caption);
    try{var signed=await data.signedAsset(asset.id);if(!chatActive(token,serial)||!parent.isConnected)return;
      var img=node('img');img.className='dm-image';img.alt=asset.original_name||'私信图片';img.src=signed.url;caption.remove();parent.appendChild(img);
      imageTimers.push(setTimeout(function(){img.removeAttribute('src');img.remove();if(parent.isConnected)parent.appendChild(node('span','图片链接已过期，刷新聊天可重新查看。','muted'));},Math.max(0,signed.expiresAt-Date.now())));
    }catch(e){if(chatActive(token,serial)&&caption.isConnected)caption.textContent='图片不可用：'+e.message;}
  }
  function renderHistory(token,serial){
    clearImages();$('dmHistory').replaceChildren();
    Array.from(history.values()).sort(function(a,b){return Number(a.message_no)-Number(b.message_no);}).forEach(function(m){
      var own=m.sender_id===identity,row=node('article',undefined,'dm-message '+(own?'dm-mine':'dm-theirs'));
      row.appendChild(node('p',(own?'我':'对方')+' · '+m.created_at.slice(0,16).replace('T',' '),'muted'));if(m.body)row.appendChild(node('p',m.body,'public-text'));
      (m.assets||[]).forEach(function(a){var slot=node('div',undefined,'dm-image-slot');row.appendChild(slot);image(slot,a,token,serial);});$('dmHistory').appendChild(row);
    });if(!history.size)$('dmHistory').appendChild(node('p','会话尚无消息。'));
  }
  async function loadHistory(token,serial,older){
    var request=++historySerial,id=selectedThread;$('dmOlder').disabled=true;var rows=await data.messages(id,older?oldest:null);
    if(!chatActive(token,serial)||request!==historySerial)return;
    rows.forEach(function(row){history.set(row.id,row);});if(rows.length)oldest=Math.min(oldest||Infinity,Number(rows.at(-1).message_no));
    renderHistory(token,serial);$('dmOlder').disabled=rows.length<20;
    if(!older&&rows.length){await data.markRead(id,Number(rows[0].message_no));if(chatActive(token,serial)){await counts(token);await threads(token);}}
  }
  async function openThread(id){
    clearChat();var token=generation,serial=threadSerial;selectedThread=id;$('dmChat').hidden=false;status('正在读取会话…',true);
    try{var info=await data.threadInfo(id);if(!chatActive(token,serial))return;$('dmPeer').replaceChildren(cards.author(info.peer));
      var url=new URL(location.href);url.searchParams.delete('user');url.searchParams.set('thread',id);url.searchParams.set('tab','dm');window.history.replaceState({},'',url);
      await loadHistory(token,serial,false);if(chatActive(token,serial))status('',true);
    }catch(e){if(chatActive(token,serial)){$('dmHistory').replaceChildren();status(e.message,true);$('dmComposer').hidden=true;}}
  }
  async function selectTab(tab,token){
    var dm=tab==='dm';$('dmPanel').hidden=!dm;$('notificationsPanel').hidden=dm;$('notificationTab').setAttribute('aria-pressed',String(!dm));$('dmTab').setAttribute('aria-pressed',String(dm));
    if(dm)await threads(token);else{clearChat();await notifications(token);}
  }
  function renderAttachments(){
    $('dmAttachments').replaceChildren();attachments.forEach(function(a){var row=node('div',undefined,'dm-attachment');row.appendChild(node('span',a.original_name,'public-text'));
      button(row,'移出本条消息',function(){attachments=attachments.filter(function(x){return x.id!==a.id;});renderAttachments();});$('dmAttachments').appendChild(row);
    });$('dmSend').disabled=uploading>0||sending;
  }
  async function assets(token){
    var serial=++assetSerial,pages=await Promise.all([data.unsent(assetOffset),data.orphans(orphanOffset)]);if(!active(token)||serial!==assetSerial)return;
    $('dmUnsent').replaceChildren();$('dmOrphans').replaceChildren();
    pages[0].forEach(function(a){var row=node('article',undefined,'dm-attachment');row.appendChild(node('span',a.original_name+' · '+a.size_bytes+' B','public-text'));
      button(row,'加入当前消息',function(){if(!selectedThread||$('dmComposer').hidden)throw Error('请先打开会话。');if(attachments.length>=4)throw Error('每条消息最多 4 张图片。');if(!attachments.some(function(x){return x.id===a.id;}))attachments.push(a);renderAttachments();});
      button(row,'删除未发送图片',async function(t){await data.removeAsset(a.id);if(active(t)){attachments=attachments.filter(function(x){return x.id!==a.id;});renderAttachments();await assets(t);}});$('dmUnsent').appendChild(row);
    });
    pages[1].forEach(function(o){var row=node('article',undefined,'dm-attachment');row.appendChild(node('span',o.object_path,'public-text'));button(row,'清理未登记上传',async function(t){await data.removeOrphan(o.object_id);if(active(t))await assets(t);});$('dmOrphans').appendChild(row);});
    if(!pages[0].length)$('dmUnsent').appendChild(node('p','暂无未发送图片。'));if(!pages[1].length)$('dmOrphans').appendChild(node('p','暂无未登记上传。'));
    $('dmAssetsPrev').disabled=assetOffset===0;$('dmAssetsNext').disabled=pages[0].length<20;$('dmOrphansPrev').disabled=orphanOffset===0;$('dmOrphansNext').disabled=pages[1].length<20;
  }
  async function load(){
    clear();var token=generation;
    try{await auth.ready();if(token!==generation)return;if(!auth.user()){location.replace('login.html?next='+encodeURIComponent('messages.html'+location.search));return;}
      identity=auth.user().id;$('messagePanels').hidden=false;var params=new URLSearchParams(location.search),dm=params.get('tab')==='dm'||params.has('thread')||params.has('user');
      await selectTab(dm?'dm':'notifications',token);if(!active(token))return;
      if(params.has('user')){var tid=await data.getThread(params.get('user'));if(!active(token))return;await openThread(tid);}else if(params.has('thread'))await openThread(params.get('thread'));
      if(active(token)){await counts(token);status('只有会话双方可以读取私信。');}
    }catch(e){if(token===generation)status(e.message);}
  }
  [['notificationTab',function(t){return selectTab('notifications',t);}],['dmTab',function(t){return selectTab('dm',t);}],['notificationRefresh',notifications],
   ['notificationPrev',function(t){notificationOffset=Math.max(0,notificationOffset-20);return notifications(t);}],['notificationNext',function(t){notificationOffset+=20;return notifications(t);}],
   ['notificationReadAll',async function(t){await blog.markNotificationsRead();if(active(t)){await notifications(t);await counts(t);}}],
   ['dmThreadsRefresh',threads],['dmThreadsPrev',function(t){threadsOffset=Math.max(0,threadsOffset-20);return threads(t);}],['dmThreadsNext',function(t){threadsOffset+=20;return threads(t);}],
   ['dmOlder',function(t){return loadHistory(t,threadSerial,true);}],['dmChatRefresh',function(t){return loadHistory(t,threadSerial,false);}],
   ['dmAssetsRefresh',assets],['dmAssetsPrev',function(t){assetOffset=Math.max(0,assetOffset-20);return assets(t);}],['dmAssetsNext',function(t){assetOffset+=20;return assets(t);}],
   ['dmOrphansPrev',function(t){orphanOffset=Math.max(0,orphanOffset-20);return assets(t);}],['dmOrphansNext',function(t){orphanOffset+=20;return assets(t);}]]
  .forEach(function(entry){$(entry[0]).addEventListener('click',function(){var token=generation;if(active(token))Promise.resolve(entry[1](token)).catch(function(e){if(active(token))status(e.message);});});});
  $('dmImages').addEventListener('change',async function(){
    var token=generation,serial=threadSerial,files=Array.from($('dmImages').files||[]);$('dmImages').value='';if(!selectedThread||!active(token))return;
    if(attachments.length+uploading+files.length>4){status('每条消息最多 4 张图片。',true);return;}uploading+=files.length;renderAttachments();
    for(var file of files){if(!chatActive(token,serial))break;
      try{var a=await data.upload(file);if(chatActive(token,serial))attachments.push(a);}catch(e){if(chatActive(token,serial))status('上传未完成：'+e.message+'；未登记上传可在清理区处理。',true);}
      finally{if(chatActive(token,serial)){uploading--;renderAttachments();}}
    }
  });
  $('dmComposer').addEventListener('submit',async function(event){
    event.preventDefault();var token=generation,serial=threadSerial,id=selectedThread;if(!active(token)||!id||uploading||sending)return;
    var body=$('dmBody').value,ids=attachments.map(function(a){return a.id;});if(Array.from(body).length>4000||(!body.trim()&&!ids.length)){status('请输入 1–4000 字或选择图片。',true);return;}
    sending=true;renderAttachments();try{await data.send(id,body,ids);if(chatActive(token,serial)){$('dmBody').value='';attachments=[];renderAttachments();await loadHistory(token,serial,false);status('已发送。',true);}}
    catch(e){if(chatActive(token,serial))status(e.message,true);}finally{if(chatActive(token,serial)){sending=false;renderAttachments();}}
  });
  document.addEventListener('blog-auth-change',load);
  setInterval(function(){var token=generation;if(active(token)&&!document.hidden)counts(token).catch(function(e){if(active(token))status(e.message);});},20000);
  window.MessageCenter={clear:clear,refresh:load,action:action};load();
})();
