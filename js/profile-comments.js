(function () {
  'use strict';
  var auth=window.BlogAuth,cards=window.PublicCards,slot=document.getElementById('profileDiscussion');
  var generation=0,item=null,offset=0,reply=null;
  function clear(){generation++;item=null;offset=0;reply=null;slot.replaceChildren();}
  function node(tag,text,cls){return cards.node(tag,text,cls);}
  async function page(token){
    var result=await auth.client().rpc('community_public_comments',{p_item_id:item,p_limit:20,p_offset:offset});
    if(result.error)throw result.error;if(token!==generation)return;
    slot.replaceChildren(node('h2','评论与回复'));
    var status=node('p',undefined,'status-line');status.setAttribute('role','status');slot.appendChild(status);
    result.data.forEach(function(c){var row=node('article',undefined,'public-content-card');row.appendChild(cards.author(c));row.appendChild(node('p',c.created_at.slice(0,10),'muted'));row.appendChild(node('p',c.content,'public-text'));
      if(c.parent_id)row.appendChild(node('p','回复评论','muted'));
      if(auth.user()){var b=node('button','回复','btn');b.type='button';b.addEventListener('click',function(){reply=c.id;status.textContent='正在回复 '+(c.display_name||c.username||'用户');});row.appendChild(b);
        if(c.author_id===auth.user().id){var link=node('a','编辑我的评论','btn');link.rel='nofollow';link.href='account.html?comment='+encodeURIComponent(c.id)+'#my-comments';row.appendChild(link);}}
      slot.appendChild(row);
    });
    if(!result.data.length)slot.appendChild(node('p','暂无公开评论。'));
    var paging=node('div',undefined,'admin-row');
    [['上一页评论',offset===0,-20],['下一页评论',result.data.length<20,20]].forEach(function(entry){var b=node('button',entry[0],'btn');b.type='button';b.disabled=entry[1];b.addEventListener('click',function(){offset+=entry[2];var request=++generation;page(request).catch(function(e){if(request===generation)status.textContent=e.message;});});paging.appendChild(b);});slot.appendChild(paging);
    if(!auth.user()){var login=node('a','登录后评论','btn');login.rel='nofollow';login.href='login.html?next='+encodeURIComponent('profile.html'+location.search);slot.appendChild(login);return;}
    var form=node('form'),label=node('label','发表评论（最多 2000 字）'),text=node('textarea'),send=node('button','提交评论','btn primary'),cancel=node('button','取消回复','btn');
    text.maxLength=4000;text.rows=3;text.setAttribute('aria-label','评论正文');send.type='submit';cancel.type='button';cancel.addEventListener('click',function(){reply=null;status.textContent='';});form.append(label,text,send,cancel);slot.appendChild(form);
    form.addEventListener('submit',async function(event){event.preventDefault();var actor=auth.user(),body=text.value,revision=generation;
      if(!actor||!body.trim()||Array.from(body).length>2000){status.textContent='请输入 1–2000 字。';return;}send.disabled=true;
      try{await window.BlogData.addComment('community-'+item,body,reply);if(revision!==generation||!auth.user()||auth.user().id!==actor.id)return;
        text.value='';reply=null;status.textContent=auth.isAdmin()?'评论已公开。':'评论已提交，审核通过后公开。';if(auth.isAdmin())await page(revision);
      }catch(e){if(revision===generation)status.textContent=e.message;}finally{send.disabled=false;}
    });
  }
  async function show(id){clear();item=id;var token=generation;try{await page(token);}catch(e){if(token===generation)slot.appendChild(node('p',e.message));}}
  document.addEventListener('blog-auth-change',clear);window.ProfileComments={clear:clear,show:show};
})();
