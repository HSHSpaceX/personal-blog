// Isolated native PostgreSQL, Unix socket only. No external database credentials.
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { prepareDatabase } from './postgres.mjs';
export const nativeConfigured = !!(process.env.PG_TEST_BIN && process.env.PG_TEST_MODULE);
export async function createNativeDatabase() {
  const imported=await import(process.env.PG_TEST_MODULE), Client=imported.Client||imported.default.Client;
  const root=await mkdtemp('/tmp/community-pg-'), bin=process.env.PG_TEST_BIN;
  const env={...process.env};
  if(process.env.PG_TEST_LIB)env.LD_LIBRARY_PATH=process.env.PG_TEST_LIB;
  const init=spawn(path.join(bin,'initdb'),['-D',path.join(root,'data'),'-U','community_test','--auth=trust','--no-locale','--encoding=UTF8'],{env});
  let initLog=''; init.stdout.on('data',d=>{initLog+=d;});init.stderr.on('data',d=>{initLog+=d;});
  const [exit]=await once(init,'exit');
  if(exit!==0){await rm(root,{recursive:true,force:true});throw Error('Local initdb failed: '+initLog);}
  const server=spawn(path.join(bin,'postgres'),['-D',path.join(root,'data'),'-k',root,'-p','55440','-c','listen_addresses='],{env});
  let log='';server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});
  const clients=[];
  async function connect(){const c=new Client({host:root,port:55440,user:'community_test',database:'postgres'});await c.connect();clients.push(c);return c;}
  async function close(){await Promise.allSettled(clients.map(c=>c.end()));if(server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
  try{
    let primary;
    for(let i=0;i<100;i++){
      try{primary=await connect();break;}catch(e){if(server.exitCode!==null)throw Error('Local postgres failed: '+log);await new Promise(r=>setTimeout(r,50));}
    }
    if(!primary)throw Error('Local PostgreSQL readiness timed out: '+log);
    const db={query:(...args)=>primary.query(...args),exec:sql=>primary.query(sql),connect,close};
    await prepareDatabase(db);
    return db;
  }catch(e){await close();throw e;}
}
