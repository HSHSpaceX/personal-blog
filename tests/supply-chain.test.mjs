import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { makeClient, runAcceptance } from '../scripts/check-supabase-rls.mjs';
const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('vendored packages have pinned provenance, licenses and verified SHA256 for every asset', async () => {
  const packages = JSON.parse(await read('assets/vendor/manifest.json'));
  assert.deepEqual(packages.map(p => [p.package,p.version]), [['@supabase/supabase-js','2.117.2'],['katex','0.16.11']]);
  const seen = new Set();
  for (const pkg of packages) {
    assert.ok(pkg.source.startsWith('https://registry.npmjs.org/'));
    assert.match(pkg.tarballIntegrity, /^sha512-/);
    assert.ok(Object.keys(pkg.files).some(file => file.endsWith('/LICENSE')));
    for (const [file, hash] of Object.entries(pkg.files)) {
      const content = await readFile(new URL('assets/vendor/' + file, root));
      assert.equal(createHash('sha256').update(content).digest('hex'), hash, file);
      seen.add(file);
    }
  }
  async function walk(directory, prefix='') {
    for (const name of await readdir(directory)) {
      const url = new URL(name, directory);
      if ((await stat(url)).isDirectory()) await walk(new URL(name+'/',directory), prefix+name+'/');
      else if (prefix+name !== 'manifest.json') assert.ok(seen.has(prefix+name), `untracked vendor asset ${prefix+name}`);
    }
  }
  await walk(new URL('assets/vendor/',root));
  const css = await read('assets/vendor/katex-0.16.11/katex.min.css');
  for (const [,file] of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(seen.has('katex-0.16.11/'+file));
});

test('first-party HTML and Auth loader execute only local scripts; KaTeX is local on admin and posts', async () => {
  for (const name of (await readdir(root)).filter(name=>name.endsWith('.html'))) {
    const html = await read(name);
    for (const [,src] of html.matchAll(/<script[^>]*\bsrc=["']([^"']+)/g)) {
      assert.doesNotMatch(src,/^(?:https?:)?\/\//,`external executable script on ${name}`);
    }
  }
  const auth = await read('js/auth.js');
  assert.match(auth,/assets\/vendor\/supabase-js-2\.117\.2\/supabase\.js/);
  assert.doesNotMatch(auth,/cdn\.jsdelivr/);
  for (const file of ['admin.html','post.html',...(await readdir(new URL('posts/',root))).map(file=>'posts/'+file)]) {
    const html=await read(file);
    assert.doesNotMatch(html,/cdn\.jsdelivr/);
    assert.match(html,/assets\/vendor\/katex-0\.16\.11\/katex\.min\.css/);
    assert.match(html,/assets\/vendor\/katex-0\.16\.11\/auto-render\.min\.js/);
  }
});

test('live acceptance uses apikey without anonymous Bearer, attaches user JWT only and bounds requests', async () => {
  const calls=[];
  const request=makeClient('https://example.supabase.co/','public-test-key',async(url,init)=>{
    calls.push({url,init});return {status:200,text:async()=>'[]'};
  });
  await request('/rest/v1/likes');
  assert.equal(calls[0].init.headers.apikey,'public-test-key');
  assert.equal(calls[0].init.headers.Authorization,undefined);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  await request('/rest/v1/likes','GET','user-test-session');
  assert.equal(calls[1].init.headers.Authorization,'Bearer user-test-session');
  await request('/auth/v1/token?grant_type=password','POST',null,{email:'test@example.invalid',password:'test-input'});
  assert.equal(calls[2].init.headers.Authorization,undefined);
  assert.equal(calls[2].init.headers['Content-Type'],'application/json');
  await assert.rejects(runAcceptance({},async()=>assert.fail('must not contact network')),/live RLS test was not run/);
  assert.throws(()=>makeClient('http://example.invalid','public-test-key'),/https/);
});
