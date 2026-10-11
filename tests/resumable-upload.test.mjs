import {test} from 'node:test';
import assert from 'node:assert/strict';
import upload from '../js/resumable-upload.js';
const path='00000001-0000-4000-8000-000000000001/00000002-0000-4000-8000-000000000002.mp4',chunk=6*1024*1024;
const file={size:90*1024*1024,type:'video/mp4',slice:(start,end)=>({start,end})};
function harness({failure=false,location='/storage/v1/upload/resumable/test',switchActor=false}={}){let offset=0,failed=false,actor=true;const calls=[];
 return {calls,options:{url:'https://fixture.supabase.invalid/',path,anonKey:'publishable-fixture',session:async()=>({access_token:'fixture-user-jwt'}),checkIdentity(){if(!actor)throw Error('账号已变化');},fetch:async(url,r)=>{
 calls.push({url,method:r.method,headers:r.headers,body:r.body});assert.equal(r.redirect,'error');assert.equal(r.headers.Authorization,'Bearer fixture-user-jwt');
 if(r.method==='POST')return {ok:true,headers:new Headers({Location:location})};
 if(r.method==='PATCH'){assert.equal(Number(r.headers['Upload-Offset']),offset);assert.ok(r.body.end-r.body.start<=chunk);offset=r.body.end;if(switchActor)actor=false;if(failure&&!failed){failed=true;throw Error('Response lost after server received chunk');}}
 return {ok:true,headers:new Headers({'Upload-Offset':String(offset)})};}}};}
test('TUS uploads 90 MiB in 6 MiB chunks and resumes a lost response using acknowledged offsets',async()=>{const h=harness({failure:true});await upload.upload(file,h.options);assert.equal(h.calls.filter(c=>c.method==='PATCH').length,15);assert.equal(h.calls.filter(c=>c.method==='HEAD').length,1);assert.equal(h.calls[0].headers['x-upsert'],'false');assert.equal(h.calls.at(-1).body.end,file.size);assert.match(h.calls[0].headers['Upload-Metadata'],/bucketName/);});
test('TUS never sends JWTs to foreign/signed locations and stops immediately on account change',async()=>{for(const location of ['https://evil.invalid/storage/v1/upload/resumable/test','https://u:p@fixture.supabase.invalid/storage/v1/upload/resumable/test','/storage/v1/upload/resumable/test?token=private']){const h=harness({location});await assert.rejects(upload.upload(file,h.options),/无效续传/);assert.equal(h.calls.length,1);}const h=harness({switchActor:true});await assert.rejects(upload.upload(file,h.options),/账号已变化/);assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1);assert.equal(h.calls.filter(c=>c.method==='HEAD').length,0);await assert.rejects(upload.upload({...file,size:file.size+1},h.options),/大小/);});
