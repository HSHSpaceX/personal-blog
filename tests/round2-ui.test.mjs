import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8'),options={skip:!process.env.COMMUNITY_DOM_MODULE&&'Configure jsdom.'};
test('Round 2 DOM: actual public search client sends bounded parameters and degrades on missing migration/configuration',options,async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,calls=[];let configured=true,error=null;
 try{w.BlogAuth={ready:async()=>{},configured:()=>configured,client:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:[],error};}})};w.eval(await read('js/public-profile-data.js'));
  await w.PublicProfileData.search('  火箭_%  ',20);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'profile_search',args:{p_query:'火箭_%',p_limit:20,p_offset:20}}]);assert.throws(()=>w.PublicProfileData.search(''));assert.throws(()=>w.PublicProfileData.search('a'));assert.equal(calls.length,1);
  error={code:'PGRST202',message:'Missing function'};await assert.rejects(w.PublicProfileData.search('火箭'),/第二轮数据库升级.*其他内容搜索/);configured=false;await assert.rejects(w.PublicProfileData.search('火箭'),/Supabase 尚未配置/);
 }finally{w.close();}
});
test('Round 2 DOM: actual admin preference APIs reject ordinary callers and discard A→B→A delayed responses',options,async()=>{
 const {JSDOM}=await import(process.env.COMMUNITY_DOM_MODULE),dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window,uid='00000001-0000-4000-8000-000000000001';let actor={id:uid},admin=false,resolve,delayed=false,writes=0;
 try{w.BlogAuth={ready:async()=>{},user:()=>actor,requireUser:()=>actor,requireAdmin(){if(!admin)throw Error('Admin required');},client:()=>({rpc:async()=>{writes++;return delayed?new Promise(r=>resolve=r):{data:null};}})};w.BackendCapabilities={requireUpgrade:async()=>{}};w.eval(await read('js/community-schema.js'));w.eval(await read('js/community-data.js'));
  for(const call of [()=>w.CommunityData.saveFeaturedPreference(uid,true),()=>w.CommunityData.submitFeaturedArticle(uid)])assert.throws(call,/Admin required/);assert.equal(writes,0);admin=true;delayed=true;const request=w.CommunityData.saveFeaturedPreference(uid,true);while(!resolve)await new Promise(r=>setImmediate(r));actor={id:'00000002-0000-4000-8000-000000000002'};w.document.dispatchEvent(new w.Event('blog-auth-change'));actor={id:uid};w.document.dispatchEvent(new w.Event('blog-auth-change'));resolve({data:null});await assert.rejects(request,/账号已变化/);
 }finally{w.close();}
});
