import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SITE_BASE_URL } from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = 'b6a50495b3bdc3a66ff892edb9b2415e'; // Public IndexNow key, never a GitHub or app credential.
const base = new URL(SITE_BASE_URL);
const keyLocation = new URL(`${key}.txt`, base).href;
assert.equal((await readFile(path.join(root, `${key}.txt`), 'utf8')).trim(), key);
const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
urlList.push(new URL('admin', base).href, new URL('login', base).href);
assert.ok(urlList.length, 'Sitemap has no URLs');
for (const address of urlList) assert.equal(new URL(address).host, base.host, `Wrong host: ${address}`);
const payload = { host: base.host, key, keyLocation, urlList };

if (process.argv.includes('--dry-run')) {
  console.log(`IndexNow ready: ${urlList.length} URL(s), key at ${keyLocation}`);
  process.exit(0);
}

// Submit only after the new static files have been deployed. A missing public key
// usually means deployment has not finished yet; callers may retry later.
const publishedKey = await fetch(keyLocation, { signal: AbortSignal.timeout(15000) });
if (!publishedKey.ok || (await publishedKey.text()).trim() !== key) {
  throw new Error(`IndexNow key is not yet publicly reachable at ${keyLocation} (HTTP ${publishedKey.status})`);
}
const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(20000)
});
if (!response.ok) throw new Error(`IndexNow rejected submission: HTTP ${response.status}, ${(await response.text()).slice(0, 300)}`);
console.log(`IndexNow accepted ${urlList.length} URL(s): HTTP ${response.status}`);
