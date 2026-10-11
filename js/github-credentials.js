/* Compatibility cleanup only. Browser GitHub authorization is permanently retired. */
(function(){
 'use strict';
 function Credentials_Clear(){
  ['blog-gh-token','blog-gh-pat-session','blog-gh-pat-temp','blog-gh-pat-owner'].forEach(function(key){
   try{localStorage.removeItem(key);}catch(error){/* Restricted storage. */}
   try{sessionStorage.removeItem(key);}catch(error){/* Restricted storage. */}
  });
  document.querySelectorAll('[data-github-pat]').forEach(function(input){input.value='';});
 }
 async function Credentials_Reject(){Credentials_Clear();throw Error('浏览器 GitHub 授权已停用，请使用网站账号和统一管理中心。');}
 Credentials_Clear();document.addEventListener('blog-auth-change',Credentials_Clear);
 window.GitHubCredentials={get:function(){return '';},clear:Credentials_Clear,connect:Credentials_Reject,validate:Credentials_Reject};
})();
