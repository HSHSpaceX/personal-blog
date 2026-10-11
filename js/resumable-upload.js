/* In-memory TUS session only; no private file, token or upload URL persistence. */
(function(root){
 'use strict';
 async function Upload_Resume(file,options){
  var origin=new URL(options.url),offset=0,uploadURL=null,chunkSize=6*1024*1024;
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!Number.isInteger(file.size)||file.size<1||file.size>90*1024*1024||!(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|pdf|txt)$/i).test(options.path))throw Error('无效上传服务地址、大小或路径。');
  async function Upload_Request(method,url,headers,body){
   options.checkIdentity();var session=await options.session();options.checkIdentity();
   if(!session||!session.access_token)throw Error('登录已过期。');
   var response=await (options.fetch||fetch)(url,{method:method,redirect:'error',signal:AbortSignal.timeout(120000),headers:Object.assign({'Tus-Resumable':'1.0.0',Authorization:'Bearer '+session.access_token,apikey:options.anonKey},headers),body:body});
   options.checkIdentity();return response;
  }
  var metadata={bucketName:'community-assets',objectName:options.path,contentType:file.type,cacheControl:'3600'};
  var result=await Upload_Request('POST',new URL('/storage/v1/upload/resumable',origin).href,{'Upload-Length':String(file.size),'Upload-Metadata':Object.keys(metadata).map(function(k){return k+' '+btoa(unescape(encodeURIComponent(metadata[k])));}).join(','),'x-upsert':'false'});
  if(!result.ok)throw Error('无法建立分块上传：HTTP '+result.status+'。请确认 Storage 支持 resumable。');
  uploadURL=new URL(result.headers.get('Location'),origin);
  if(uploadURL.origin!==origin.origin||uploadURL.username||uploadURL.password||!uploadURL.pathname.startsWith('/storage/v1/upload/resumable/')||uploadURL.search||uploadURL.hash)throw Error('无效续传地址。');
  while(offset<file.size){
   var target=Math.min(file.size,offset+chunkSize),done=false;
   for(var attempt=0;attempt<3&&!done;attempt++){
    try{var response=await Upload_Request('PATCH',uploadURL.href,{'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},file.slice(offset,target));
     if(!response.ok)throw Error('分块上传失败：HTTP '+response.status);
     var header=response.headers.get('Upload-Offset'),next=Number(header);if(header===null||next!==target)throw Error('上传进度不一致。');offset=next;done=true;
    }catch(error){options.checkIdentity();if(attempt===2)throw error;var head=await Upload_Request('HEAD',uploadURL.href,{}),known=Number(head.headers.get('Upload-Offset'));
     if(!head.ok||head.headers.get('Upload-Offset')===null||!Number.isInteger(known)||known<offset||known>target)throw Error('无法安全恢复分块上传。');offset=known;if(offset===target)done=true;
    }
   }
   if(options.progress)options.progress(offset,file.size);
  }
 }
 var api={upload:Upload_Resume};if(typeof module==='object'&&module.exports)module.exports=api;else root.CommunityUpload=api;
})(typeof window==='object'?window:globalThis);
