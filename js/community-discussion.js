/* Album discussion uses stable item IDs, approved public RPCs and safe DOM. */
(function(){
 'use strict';var generation=0,item=null,reply=null;
 function slot(){var el=document.getElementById('communityDiscussion');if(!el){el=document.createElement('section');el.id='communityDiscussion';el.className='container comments-section';document.getElementById('albumView').appendChild(el);}return el;}
 function node(tag,text){var el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
 function clear(){generation++;item=null;reply=null;slot().replaceChildren();}
 async function show(id){clear();if(!id)return;item=id;var token=generation,auth=window.BlogAuth,s=slot();await auth.ready();if(token!==generation)return;
  var likes=node('button','点赞'),count=node('span','…');likes.type='button';likes.className='btn';s.append(likes,count);
  async function refresh(){var rows=await window.BlogData.likes('content',[id]);if(token!==generation)return;count.textContent=' '+String((rows[id]||{}).count||0);}
  likes.addEventListener('click',async function(){if(!auth.user()){location.href='login.html?next='+encodeURIComponent(location.pathname+location.search);return;}likes.disabled=true;try{await window.BlogData.toggleLike('content',id);await refresh();}catch(e){if(token===generation)status.textContent=e.message;}finally{likes.disabled=false;}});
  var list=node('div'),status=node('p'),offset=0;s.append(list,status);status.className='status-line';
  async function page(){var result=await auth.client().rpc('community_public_comments',{p_item_id:id,p_limit:20,p_offset:offset});if(token!==generation)return;if(result.error)throw result.error;list.replaceChildren(node('h2','评论与回复'));
   result.data.forEach(function(c){var row=node('article');row.className='public-content-card';row.append(window.PublicCards.author(c),node('p',c.created_at.slice(0,10)),node('p',c.content));if(c.parent_id)row.append(node('p','回复评论'));var b=node('button','回复');b.type='button';b.className='btn';b.addEventListener('click',function(){reply=c.id;status.textContent='回复 '+(c.display_name||c.username);});row.append(b);list.append(row);});
   [['上一页',offset===0,-20],['下一页',result.data.length<20,20]].forEach(function(a){var b=node('button',a[0]);b.type='button';b.className='btn';b.disabled=a[1];b.addEventListener('click',function(){offset+=a[2];page().catch(e=>{if(token===generation)status.textContent=e.message;});});list.append(b);});}
  var form=node('form'),text=node('textarea'),send=node('button','提交评论'),cancel=node('button','取消回复');text.rows=3;text.maxLength=2000;text.setAttribute('aria-label','图册评论');send.type='submit';send.className='btn';cancel.type='button';cancel.className='btn';cancel.addEventListener('click',function(){reply=null;status.textContent='';});form.append(text,send,cancel);s.append(form);
  form.addEventListener('submit',async function(e){e.preventDefault();if(!auth.user()){location.href='login.html?next='+encodeURIComponent(location.pathname+location.search);return;}var actor=auth.user().id;send.disabled=true;try{await window.BlogData.addComment('community-'+id,text.value,reply);if(token!==generation||!auth.user()||auth.user().id!==actor)return;text.value='';reply=null;status.textContent='评论已提交，审核通过后公开。';await page();}catch(e){if(token===generation)status.textContent=e.message;}finally{send.disabled=false;}});
  try{await Promise.all([refresh(),page()]);}catch(e){if(token===generation)status.textContent=e.message;}
 }
 document.addEventListener('blog-auth-change',function(){var id=item;clear();if(id)show(id);});window.CommunityDiscussion={clear:clear,show:show};
})();
