(function () {
  'use strict';
  var auth=window.BlogAuth,data=window.PublicProfileData,cards=window.PublicCards;
  window.BlogTheme.setup();
  var $=function(id){return document.getElementById(id);};
  var target=null,generation=0,pageGeneration=0,tab='moment',offset=0,legacyRows=[],legacyIndex=0,pageStartLegacy=0,cursors=[],hasNext=false;
  function status(text,error){$('profileStatus').textContent=text;$('profileStatus').className='status-line '+(error?'err':'ok');}
  function clear(){generation++;pageGeneration++;target=null;$('profileCards').replaceChildren();$('profileDetail').replaceChildren();$('profileLogout').hidden=true;$('profileEditor').hidden=true;$('profileOwnLinks').hidden=true;$('followBtn').hidden=true;$('profileMessage').hidden=true;
    ['profileUsernameInput','profileDisplayInput','profileBioInput','profileAvatarInput'].forEach(function(id){$(id).value='';});}
  async function load(){
    clear();var token=generation;
    try{
      await auth.ready();if(token!==generation)return;
      var params=new URLSearchParams(location.search),query=params.get('username')?{username:params.get('username')}:{id:params.get('id')||(auth.user()&&auth.user().id)};
      if(!query.username&&!query.id)query={username:'hshspacex'};
      var loaded=await data.profile(query);if(token!==generation)return;target=loaded;
      if(!target)throw Error('找不到该用户资料。');
      $('profileName').textContent=target.display_name||target.username;$('profileUsername').textContent='@'+target.username;$('profileBio').textContent=target.bio||'还没有简介。';$('profileAvatar').src=cards.avatar(target.avatar_url);
      var own=!!auth.user()&&auth.user().id===target.id;$('profileOwnLinks').hidden=!own;$('profileLogout').hidden=!own;$('profileMessage').hidden=!auth.user()||own;
      $('profileEditor').hidden=!own||params.get('edit')!=='1';
      if(own){$('profileUsernameInput').value=target.username;$('profileDisplayInput').value=target.display_name;$('profileBioInput').value=target.bio;}
      if(auth.user()&&!own){$('followBtn').hidden=false;var following=await window.BlogData.following(target.id);if(token!==generation)return;$('followBtn').textContent=following?'取消关注':'关注';}
      var counts=await data.counts(target.id);if(token!==generation)return;$('profileFollowers').textContent=counts[0]+' 粉丝';$('profileFollowing').textContent=counts[1]+' 关注';
      tab=params.get('tab')||'moment';if(!['moment','article','album','comment','likes','followers','following'].includes(tab))tab='moment';
      await changeTab(tab);
      if(token!==generation)return;
      if(params.get('item')){var card=await data.item(params.get('item'));if(token!==generation)return;$('profileDetail').replaceChildren(cards.content(card,true));}
      status('公开主页。');
    }catch(e){if(token===generation)status(e.message,true);}
  }
  function followCard(p,token){
    var row=cards.node('article',undefined,'public-user-card');row.appendChild(cards.author(p));row.appendChild(cards.node('p',p.bio||'还没有简介。','public-text'));
    if(auth.user()&&auth.user().id!==p.id){var b=cards.node('button','关注','btn');b.type='button';row.appendChild(b);
      window.BlogData.following(p.id).then(function(has){if(token===pageGeneration)b.textContent=has?'取消关注':'关注';});
      b.addEventListener('click',async function(){var actor=auth.user();if(!actor)return;b.disabled=true;try{var has=await window.BlogData.toggleFollow(p.id);if(token===pageGeneration&&auth.user()&&auth.user().id===actor.id)b.textContent=has?'取消关注':'关注';}catch(e){if(token===pageGeneration)status(e.message,true);}finally{b.disabled=false;}});
    }return row;
  }
  async function showPage(){
    var token=++pageGeneration,identity=generation;var rows;
    $('profileCards').replaceChildren();$('profilePrev').disabled=true;$('profileNext').disabled=true;
    try{
      if(tab==='followers'||tab==='following')rows=await data[tab](target.id,offset);
      else if(tab==='likes')rows=await data.likes(target.id,offset);
      else rows=await data.content(target.id,tab,offset);
      if(token!==pageGeneration||identity!==generation)return;
      // Community data is paged by the server; append a bounded slice of the
      // legacy compatibility stream once Community pages end, without ownership.
      hasNext=rows.length===20;pageStartLegacy=legacyIndex;
      if(tab==='likes')rows=rows.map(data.resolveLegacy).filter(Boolean);
      if(!['followers','following','likes','comment'].includes(tab)&&rows.length<20){var extra=legacyRows.slice(legacyIndex,legacyIndex+20-rows.length);rows=rows.concat(extra);legacyIndex+=extra.length;hasNext=legacyIndex<legacyRows.length;}
      rows.forEach(function(r){$('profileCards').appendChild(tab==='followers'||tab==='following'?followCard(r,token):cards.content(r));});
      if(!rows.length)$('profileCards').appendChild(cards.node('p','暂无公开内容。'));
      $('profilePageLabel').textContent='第 '+(cursors.length+1)+' 页';$('profilePrev').disabled=cursors.length===0;$('profileNext').disabled=!hasNext;
    }catch(e){if(token===pageGeneration)status(e.message,true);}
  }
  async function changeTab(next){tab=next;offset=0;legacyIndex=0;cursors=[];legacyRows=target.username.toLowerCase()==='hshspacex'?data.legacy(tab):[];
    document.querySelectorAll('[data-profile-tab]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.profileTab===tab));});await showPage();}
  document.querySelectorAll('[data-profile-tab]').forEach(function(b){b.addEventListener('click',function(){if(target)changeTab(b.dataset.profileTab);});});
  $('profileFollowers').addEventListener('click',function(){if(target)changeTab('followers');});$('profileFollowing').addEventListener('click',function(){if(target)changeTab('following');});
  $('profileNext').addEventListener('click',function(){cursors.push({offset:offset,legacyIndex:pageStartLegacy});offset+=20;showPage();});
  $('profilePrev').addEventListener('click',function(){var prev=cursors.pop();if(prev){offset=prev.offset;legacyIndex=prev.legacyIndex;showPage();}});
  $('profileEdit').addEventListener('click',function(){$('profileEditor').hidden=false;});
  $('profileSave').addEventListener('click',async function(){var token=generation;try{var actor=auth.requireUser().id;if(!target||target.id!==actor)throw Error('只能编辑自己的资料。');var username=$('profileUsernameInput').value.trim();if(!/^[a-zA-Z0-9_]{3,30}$/.test(username))throw Error('用户名须为 3–30 个英文、数字或下划线。');$('profileSave').disabled=true;
    await window.BlogData.saveProfile({username:username,display_name:$('profileDisplayInput').value.trim(),bio:$('profileBioInput').value.trim()},actor);if(token!==generation)return;
    var file=$('profileAvatarInput').files[0];if(file)await window.BlogData.uploadAvatar(file,actor);if(token!==generation)return;
    var url=new URL(location.href);url.searchParams.delete('id');url.searchParams.set('username',username);history.replaceState({},'',url);await load();status('资料已保存。');
    }catch(e){if(token===generation)status(e.message,true);}finally{$('profileSave').disabled=false;}});
  $('followBtn').addEventListener('click',async function(){var token=generation;if(!auth.user()||!target)return;try{$('followBtn').disabled=true;await window.BlogData.toggleFollow(target.id);if(token===generation)await load();}catch(e){if(token===generation)status(e.message,true);}finally{$('followBtn').disabled=false;}});
  $('profileLogout').addEventListener('click',async function(){clear();await auth.signOut();await load();});
  document.addEventListener('blog-auth-change',load);load();
})();
