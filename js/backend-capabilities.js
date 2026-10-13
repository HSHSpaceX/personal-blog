(function(){
 'use strict';
 var generation=0;
 document.addEventListener('blog-auth-change',function(){generation++;});
 async function Backend_RequireUpgrade(){var auth=window.BlogAuth,actor=auth.requireUser().id,token=generation;await auth.ready();if(token!==generation||!auth.user()||auth.user().id!==actor)throw Error('账号已变化；操作已取消。');var result=await auth.client().rpc('community_capabilities');if(token!==generation||!auth.user()||auth.user().id!==actor)throw Error('账号已变化；操作已取消。');if(result.error||!result.data||result.data.version!==20261013)throw Error('服务器尚未完成升级；操作未执行，请站长完成数据库操作包。');}
 window.BackendCapabilities={requireUpgrade:Backend_RequireUpgrade};
})();
