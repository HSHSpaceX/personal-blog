(function () {
  'use strict';
  if (window.parent===window || new URLSearchParams(location.search).get('workspace')!=='1') return;
  document.body.classList.add('workspace-embedded');
  function Workspace_ReportHeight() { var main=document.querySelector('main');if(main)window.parent.postMessage({type:'account-frame-height',height:main.getBoundingClientRect().height},location.origin); }
  if(window.ResizeObserver)new ResizeObserver(Workspace_ReportHeight).observe(document.body);
  window.addEventListener('load',Workspace_ReportHeight);
})();
