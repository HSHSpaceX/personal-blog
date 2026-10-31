(function () {
  'use strict';
  function node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function avatar(url){if(typeof url!=='string'||!url)return 'assets/avatar-default.jpg';try{var u=new URL(url,document.baseURI||location.href);if(u.username||u.password||/\/storage\/v1\/object\/(?:sign|authenticated)\//.test(u.pathname)||Array.from(u.searchParams.keys()).some(function(k){return /token|signature|credential/i.test(k);}))return 'assets/avatar-default.jpg';if(u.protocol==='https:'||u.origin===location.origin&&u.protocol==='http:')return u.href;}catch(e){}return 'assets/avatar-default.jpg';}
  function author(p){
    var username=p.username||'',valid=/^[a-zA-Z0-9_]{3,30}$/.test(username);
    var a=node(valid?'a':'span',undefined,'public-author');if(valid){a.href='profile.html?username='+encodeURIComponent(username);a.rel='nofollow';}
    var img=node('img');img.src=avatar(p.avatar_url);if(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id||p.author_id||''))img.dataset.avatarId=p.author_id||p.id;else if(valid)img.dataset.avatarUser=username;img.alt=p.username==='hshspacex'&&p.display_name==='HSH(站长)'?'HSH站长头像':(p.display_name||username||'用户')+'的头像';img.width=36;img.height=36;a.appendChild(img);
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
  // Refresh only public avatars. Never infer an author from their name/role,
  // change content ownership, or send the viewer's private session credentials.
  var avatarCache=new Map(),avatarPending=new Set(),avatarScheduled=false;
  async function Avatar_Refresh(){
    avatarScheduled=false;
    if(!window.document)return;
    var config=window.BlogConfig||{};
    if(!config.SUPABASE_URL||!config.SUPABASE_PUBLISHABLE_KEY||!window.fetch)return;
    var images=Array.from(document.querySelectorAll('img[data-avatar-id],img[data-avatar-user]'));
    for(var field of ['id','username']){
      var attr=field==='id'?'avatarId':'avatarUser',valid=field==='id'?/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i:/^[a-zA-Z0-9_]{3,30}$/;
      var values=Array.from(new Set(images.map(function(img){return img.dataset[attr];}).filter(function(v){return valid.test(v||'')&&!avatarCache.has(field+':'+v)&&!avatarPending.has(field+':'+v);})));
      for(var start=0;start<values.length;start+=50){
        var batch=values.slice(start,start+50);batch.forEach(function(v){avatarPending.add(field+':'+v);});
        try{
          var endpoint=new URL('/rest/v1/profiles',config.SUPABASE_URL);
          if(endpoint.protocol!=='https:')throw Error('Invalid profile endpoint');
          endpoint.searchParams.set('select',field+',avatar_url');endpoint.searchParams.set(field,'in.('+batch.join(',')+')');endpoint.searchParams.set('limit','50');
          var response=await window.fetch(endpoint.href,{headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});
          if(!response.ok)throw Error('Profile unavailable');var rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid profiles');
          batch.forEach(function(v){avatarCache.set(field+':'+v,null);});
          rows.forEach(function(p){if(batch.includes(p[field]))avatarCache.set(field+':'+p[field],avatar(p.avatar_url));});
        }catch(e){batch.forEach(function(v){avatarCache.set(field+':'+v,null);}); /* Keep the published fallback offline. */}
        finally{batch.forEach(function(v){avatarPending.delete(field+':'+v);});}
      }
    }
    if(!window.document)return;
    document.querySelectorAll('img[data-avatar-id],img[data-avatar-user]').forEach(function(img){var key=img.dataset.avatarId?'id:'+img.dataset.avatarId:'username:'+img.dataset.avatarUser,next=avatarCache.get(key);if(next&&img.getAttribute('src')!==next)img.src=next;});
  }
  function Avatar_Schedule(){if(!avatarScheduled){avatarScheduled=true;queueMicrotask(Avatar_Refresh);}}
  if(window.MutationObserver&&document.documentElement){new MutationObserver(Avatar_Schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-avatar-id','data-avatar-user']});Avatar_Schedule();document.addEventListener('blog-profile-saved',function(){avatarCache.clear();Avatar_Schedule();});}
})();
