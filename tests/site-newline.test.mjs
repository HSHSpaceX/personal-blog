import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Fixture_CopySite} from './helpers/site-fixture.mjs';
test('static generation preserves favicons and theme scripts identically for LF and Windows CRLF',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'blog-newline-'));
 try{
  await Fixture_CopySite(new URL('../',import.meta.url),dir);
  const template=(await readFile(path.join(dir,'post.html'),'utf8')).replace(/\r\n?/g,'\n');
  const generate=()=>execFileSync(process.execPath,['scripts/generate-site.mjs'],{cwd:dir,stdio:'pipe'});
  await writeFile(path.join(dir,'post.html'),template);generate();
  const expected=await readFile(path.join(dir,'posts/post-austria-history.html'),'utf8');
  await writeFile(path.join(dir,'post.html'),template.replace(/\n/g,'\r\n'));generate();
  const actual=await readFile(path.join(dir,'posts/post-austria-history.html'),'utf8');assert.equal(actual,expected);
  assert.match(actual,/assets\/icon-light\.png/);assert.match(actual,/assets\/icon-dark\.png/);assert.match(actual,/localStorage\.getItem\('blog-theme'\)/);assert.doesNotMatch(actual,/\r/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
