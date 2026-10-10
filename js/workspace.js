(function () {
  'use strict';
  function Workspace_Create(options) {
    var root=options.root, nav=options.nav, toggle=options.toggle, backdrop=options.backdrop, current='', enabled=false;
    var aliases={main:'overview',content:'articles',settings:'security'};
    var panels=Array.from(root.querySelectorAll('[data-workspace-panel]'));
    var routes={articles:'content',moments:'content',albums:'content'};
    function Workspace_SetExpanded(expanded) {
      root.classList.toggle('directory-open',expanded);toggle.setAttribute('aria-expanded',String(expanded));
      toggle.setAttribute('aria-label',expanded?'收起目录':'展开目录');
      if(backdrop)backdrop.hidden=!expanded;
      var mobile=window.matchMedia('(max-width: 700px)').matches,body=root.querySelector('.workspace-body');
      if(body)body.inert=mobile&&expanded;
      try{sessionStorage.setItem(options.key||'account-directory',String(expanded));}catch(error){/* Optional layout preference. */}
    }
    function Workspace_Show(route,focus) {
      if(!enabled)return;
      route=aliases[route]||route;var panelId=routes[route]||route;
      var panel=panels.find(function(p){return p.id===panelId && (!p.dataset.adminPanel || window.BlogAuth.isAdmin());});
      if(!panel){route='overview';panelId=route;panel=panels.find(function(p){return p.id===route;});}
      if(!panel)return;
      current=route;panels.forEach(function(p){p.hidden=p!==panel;});
      nav.querySelectorAll('[data-workspace-route]').forEach(function(a){if(a.dataset.workspaceRoute===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
      root.dataset.activeModule=route;
      if(panelId==='content')root.dataset.contentType=route==='moments'?'moment':route==='albums'?'album':'article';
      window.dispatchEvent(new CustomEvent('workspace-route-change',{detail:{route:route,panel:panelId,type:root.dataset.contentType}}));
      if(window.matchMedia('(max-width: 700px)').matches)Workspace_SetExpanded(false);
      if(focus){panel.setAttribute('tabindex','-1');panel.focus({preventScroll:true});}
      var frame=panel.querySelector('iframe[data-account-frame]');if(frame && !frame.getAttribute('src'))frame.src=frame.dataset.accountFrame;
    }
    function Workspace_Restore() {
      var route=location.hash.slice(1);if(!route){var q=new URLSearchParams(location.search);route=q.has('comment')?'my-comments':q.has('revision')?'articles':q.has('edit')?'profile':'overview';}
      Workspace_Show(route,false);
    }
    function Workspace_Navigate(route) { if(location.hash==='#'+route)Workspace_Show(route,true);else location.hash=route; }
    toggle.addEventListener('click',function(){Workspace_SetExpanded(toggle.getAttribute('aria-expanded')!=='true');if(toggle.getAttribute('aria-expanded')==='true'){var first=nav.querySelector('a:not([hidden])');if(first)first.focus();}});
    if(backdrop)backdrop.addEventListener('click',function(){Workspace_SetExpanded(false);toggle.focus();});
    nav.addEventListener('click',function(e){var a=e.target.closest('[data-workspace-route]');if(a){e.preventDefault();Workspace_Navigate(a.dataset.workspaceRoute);}});
    nav.addEventListener('keydown',function(e){if(e.key==='Escape'){Workspace_SetExpanded(false);toggle.focus();return;}if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;var links=Array.from(nav.querySelectorAll('a,button')).filter(function(a){return !a.closest('[hidden]');});var index=links.indexOf(document.activeElement);if(index<0)return;e.preventDefault();var next=e.key==='Home'?0:e.key==='End'?links.length-1:(index+(e.key==='ArrowUp'?-1:1)+links.length)%links.length;links[next].focus();});
    window.addEventListener('hashchange',Workspace_Restore);window.addEventListener('popstate',Workspace_Restore);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&root.classList.contains('directory-open')){Workspace_SetExpanded(false);toggle.focus();}if(e.key==='Tab'&&root.classList.contains('directory-open')&&window.matchMedia('(max-width: 700px)').matches){var focusable=[toggle].concat(Array.from(nav.querySelectorAll('a,button')).filter(function(a){return !a.closest('[hidden]');}));var first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    window.addEventListener('resize',function(){var body=root.querySelector('.workspace-body');if(body)body.inert=window.matchMedia('(max-width: 700px)').matches&&root.classList.contains('directory-open');});
    var expanded=false;try{expanded=sessionStorage.getItem(options.key||'account-directory')==='true'&&!window.matchMedia('(max-width: 700px)').matches;}catch(error){/* Optional preference. */}Workspace_SetExpanded(expanded);
    return {navigate:Workspace_Navigate,refresh:Workspace_Restore,setEnabled:function(value){enabled=value;if(value)Workspace_Restore();else {panels.forEach(function(p){p.hidden=true;});root.querySelectorAll('iframe[data-account-frame]').forEach(function(f){f.removeAttribute('src');});Workspace_SetExpanded(false);}}};
  }
  window.AccountWorkspace={create:Workspace_Create};
})();
