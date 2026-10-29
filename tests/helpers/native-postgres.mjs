// Isolated native PostgreSQL: Unix socket, or Windows loopback only. No external credentials.
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import { prepareDatabase } from './postgres.mjs';
export const nativeConfigured = !!(process.env.PG_TEST_BIN && process.env.PG_TEST_MODULE);
export async function createNativeDatabase(options = {}) {
  const imported=await import(process.env.PG_TEST_MODULE), Client=imported.Client||imported.default.Client;
  const root=await mkdtemp(path.join(tmpdir(),'community-pg-')), bin=process.env.PG_TEST_BIN;
  const windows=process.platform==='win32';
  const port=windows?await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});}):55440;
  const env={...process.env};
  if(process.env.PG_TEST_LIB)env.LD_LIBRARY_PATH=process.env.PG_TEST_LIB;
  const init=spawn(path.join(bin,'initdb'),['-D',path.join(root,'data'),'-U','community_test','--auth=trust','--no-locale','--encoding=UTF8'],{env,windowsHide:true});
  let initLog=''; init.stdout.on('data',d=>{initLog+=d;});init.stderr.on('data',d=>{initLog+=d;});
  const [exit]=await once(init,'exit');
  if(exit!==0){await rm(root,{recursive:true,force:true});throw Error('Local initdb failed: '+initLog);}
  const server=spawn(path.join(bin,'postgres'),['-D',path.join(root,'data'),'-k',windows?'':root,'-p',String(port),'-c','listen_addresses='+(windows?'127.0.0.1':'')],{env,windowsHide:true});
  let log='';server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});
  const clients=[];
  async function connect(){const c=new Client({host:windows?'127.0.0.1':root,port,user:'community_test',database:'postgres'});await c.connect();clients.push(c);return c;}
  async function close(){await Promise.allSettled(clients.map(c=>c.end()));if(server.exitCode===null){const exited=once(server,'exit');if(windows){const stop=spawn(path.join(bin,'pg_ctl'),['stop','-D',path.join(root,'data'),'-m','fast','-w'],{env});await once(stop,'exit');}else server.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  try{
    let primary;
    for(let i=0;i<100;i++){
      try{primary=await connect();break;}catch(e){if(server.exitCode!==null)throw Error('Local postgres failed: '+log);await new Promise(r=>setTimeout(r,50));}
    }
    if(!primary)throw Error('Local PostgreSQL readiness timed out: '+log);
    const db={query:(...args)=>primary.query(...args),exec:sql=>primary.query(sql),connect,close};
    await prepareDatabase(db,options);
    return db;
  }catch(e){await close();throw e;}
}
