import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Fixture_CopySite} from './helpers/site-fixture.mjs';

test('fixture copy accepts a runner work ancestor and excludes only repository scratch/dependencies',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'fixture-copy-'));
 try{
  const source=path.join(temp,'work','personal-blog'),destination=path.join(temp,'copy');
  for(const name of ['js','data','work','.git','node_modules']){
   await mkdir(path.join(source,name),{recursive:true});
   await writeFile(path.join(source,name,'probe.txt'),name);
  }
  await Fixture_CopySite(source,destination);
  for(const name of ['js','data'])assert.equal(await readFile(path.join(destination,name,'probe.txt'),'utf8'),name);
  for(const name of ['work','.git','node_modules'])await assert.rejects(access(path.join(destination,name)),{code:'ENOENT'});
 }finally{await rm(temp,{recursive:true,force:true});}
});
