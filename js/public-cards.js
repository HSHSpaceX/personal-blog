(function () {
  'use strict';
  function node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function avatar(url){if(typeof url!=='string'||!url)return 'assets/avatar-default.jpg';try{var u=new URL(url,location.href);if(u.protocol==='https:'||u.origin===location.origin)return u.href;}catch(e){}return 'assets/avatar-default.jpg';}
  function author(p){
    var username=p.username||'',valid=/^[a-zA-Z0-9_]{3,30}$/.test(username);
    var a=node(valid?'a':'span',undefined,'public-author');if(valid)a.href='profile.html?username='+encodeURIComponent(username);
    var img=node('img');img.src=avatar(p.avatar_url);img.alt=p.username==='hshspacex'&&p.display_name==='HSH(站长)'?'HSH站长头像':(p.display_name||username||'用户')+'的头像';img.width=36;img.height=36;a.appendChild(img);
    a.appendChild(node('span',(p.display_name||username||'已注销用户')+(valid?' / @'+username:'')));return a;
  }
  function safeLink(path){try{var u=new URL(path,location.href);if(u.origin===location.origin&&['/profile.html','/moments.html','/gallery.html','/about.html'].includes(u.pathname)||u.origin===location.origin&&/^\/posts\/[a-z0-9_-]+\.html$/i.test(u.pathname))return u.href;}catch(e){}return null;}
  function content(card,detail){
    var n=node('article',undefined,'public-content-card'),h=node('h3',card.title||({moment:'动态',album:'图册',article:'文章',comment:'评论'}[card.kind]));n.appendChild(author(card));n.appendChild(h);
    n.appendChild(node('p',String(card.published_at||'').slice(0,16)+(card.liked_at?' · 点赞于 '+String(card.liked_at).slice(0,16):''),'muted'));
    n.appendChild(node('p',String(card.text||'').slice(0,detail?100000:2000),'public-text'));
    if(card.context)n.appendChild(node('p','来自：'+card.context.title));
    if(card.parent_text)n.appendChild(node('blockquote','回复：'+card.parent_text,'public-text'));
    if(card.kind==='album'&&card.body&&Array.isArray(card.body.photos))n.appendChild(node('p',card.body.photos.length+' 张私有附件 · 公开文本预览'));
    var href=card.target_path&&safeLink(card.target_path);if(href){var a=node('a','查看内容','btn');a.href=href;n.appendChild(a);}
    var auth=window.BlogAuth;
    if(auth&&auth.user()&&card.target_type&&card.target_id){var b=node('button','点赞 / 取消点赞','btn');b.type='button';b.addEventListener('click',async function(){b.disabled=true;try{var now=await window.BlogData.toggleLike(card.target_type,card.target_id);b.textContent=now?'已点赞 · 取消点赞':'点赞';}catch(e){b.textContent=e.message;}finally{b.disabled=false;}});n.appendChild(b);}
    return n;
  }
  window.PublicCards={node:node,author:author,content:content,avatar:avatar};
})();
