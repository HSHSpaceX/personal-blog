(function () {
  'use strict';
  var auth=window.BlogAuth,data=window.CommentEditData,$=function(id){return document.getElementById(id);};
  var generation=0,offset=0,queueOffset=0,selected=null;
  function node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function active(t){return t===generation&&!!auth.user();}
  function message(text){$('accountCommentsStatus').textContent=text;}
  function button(row,text,fn){var b=node('button',text,'btn');b.type='button';b.addEventListener('click',async function(){var t=generation;b.disabled=true;try{auth.requireUser();await fn(t);}catch(e){if(active(t))message(e.message);}finally{b.disabled=false;}});row.appendChild(b);}
  function clear(){generation++;selected=null;offset=0;queueOffset=0;['accountCommentsList','accountCommentQueue','accountCommentsStatus','accountCommentIdentity'].forEach(function(id){$(id).replaceChildren();});$('accountCommentEditor').hidden=true;$('accountCommentText').value='';}
  function editor(c){selected=c;$('accountCommentEditor').hidden=false;$('accountCommentText').value=c.latest_edit?c.latest_edit.proposed_content:c.content;$('accountCommentIdentity').textContent='评论 / '+c.post_slug+' · '+c.status;}
  async function mine(t){var rows=await data.mine(offset);if(!active(t))return;$('accountCommentsList').replaceChildren();
    rows.forEach(function(c){var row=node('article',undefined,'public-content-card');row.appendChild(node('p',c.post_slug+' · '+c.created_at.slice(0,10)+' · '+c.status));row.appendChild(node('p',c.content,'public-text'));
      if(c.latest_edit){row.appendChild(node('p','最新编辑：'+c.latest_edit.status));if(c.latest_edit.rejection_reason)row.appendChild(node('p','驳回原因：'+c.latest_edit.rejection_reason,'public-text'));}
      if(!(c.status==='approved'&&c.latest_edit&&c.latest_edit.status==='pending'&&!auth.isAdmin()))button(row,'编辑我的评论',function(){editor(c);});
      $('accountCommentsList').appendChild(row);});if(!rows.length)$('accountCommentsList').appendChild(node('p','暂无自己的评论。'));
    $('accountCommentsPrev').disabled=offset===0;$('accountCommentsNext').disabled=rows.length<20;
  }
  function reviewCard(e){var row=node('article',undefined,'public-content-card');row.appendChild(node('p','评论编辑 · '+e.created_at.slice(0,10)));row.appendChild(node('p','原正文：'+e.previous_content,'public-text'));row.appendChild(node('p','新正文：'+e.proposed_content,'public-text'));
    var reason=node('textarea');reason.maxLength=2000;reason.rows=2;reason.setAttribute('aria-label','拒绝此评论编辑的原因');row.appendChild(reason);
    button(row,'通过评论编辑',async function(t){auth.requireAdmin();await data.review(e.id,'approved',null);if(active(t))await refresh();});
    button(row,'拒绝评论编辑',async function(t){auth.requireAdmin();if(!reason.value.trim())throw Error('拒绝必须填写原因。');await data.review(e.id,'rejected',reason.value.trim());if(active(t))await refresh();});return row;
  }
  async function queue(t){if(!auth.isAdmin())return;var rows=await data.queue(queueOffset);if(!active(t)||!auth.isAdmin())return;$('accountCommentQueue').replaceChildren();rows.forEach(function(e){$('accountCommentQueue').appendChild(reviewCard(e));});if(!rows.length)$('accountCommentQueue').appendChild(node('p','暂无待审评论编辑。'));$('accountCommentQueuePrev').disabled=queueOffset===0;$('accountCommentQueueNext').disabled=rows.length<20;}
  async function refresh(){var t=++generation;try{auth.requireUser();await mine(t);await queue(t);if(!active(t))return;var params=new URLSearchParams(location.search);
    if(params.get('comment')){var c=await data.ownComment(params.get('comment'));if(active(t))editor(c);}
    if(params.get('edit')){var e=await data.getEdit(params.get('edit'));if(!active(t))return;
      if(e.author_id===auth.user().id){var own=await data.ownComment(e.comment_id);if(active(t))editor(own);}
      else if(auth.isAdmin())$('accountCommentQueue').replaceChildren(e.status==='pending'?reviewCard(e):node('p','该编辑已处理：'+e.status));
    }
  }catch(e){if(active(t))message(e.message);}}
  [['accountCommentsRefresh',function(t){return mine(t);}],['accountCommentsPrev',function(t){offset=Math.max(0,offset-20);return mine(t);}],['accountCommentsNext',function(t){offset+=20;return mine(t);}],
  ['accountCommentQueuePrev',function(t){queueOffset=Math.max(0,queueOffset-20);return queue(t);}],['accountCommentQueueNext',function(t){queueOffset+=20;return queue(t);}]]
  .forEach(function(entry){$(entry[0]).addEventListener('click',async function(){try{auth.requireUser();await entry[1](generation);}catch(e){message(e.message);}});});
  $('accountCommentSubmit').addEventListener('click',async function(){var t=generation;try{auth.requireUser();if(!selected)throw Error('请选择自己的评论。');var text=$('accountCommentText').value;if(!text.trim()||Array.from(text).length>2000)throw Error('评论须为 1–2000 字。');$('accountCommentSubmit').disabled=true;await data.save(selected.id,text);if(active(t)){$('accountCommentEditor').hidden=true;await refresh();message('评论修改已提交；通过前保留原公开正文。');}}catch(e){if(active(t))message(e.message);}finally{$('accountCommentSubmit').disabled=false;}});
  window.AccountComments={clear:clear,refresh:refresh};
})();
