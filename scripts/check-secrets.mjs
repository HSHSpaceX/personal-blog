// Scan source/generated files without printing matched credentials or values.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
async function walk(directory, prefix='') {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (entry.isDirectory()) {
      if (!['.git','node_modules','.playwright-cli','work'].includes(entry.name)) await walk(path.join(directory,entry.name), prefix+entry.name+'/');
    } else if (entry.isFile()) files.push(prefix+entry.name);
  }
}
await walk(root);
const rules = [
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['literal password assignment', /\b(?:password|passwd|TEST_\w+_PASSWORD)\s*[:=]\s*['"][^'"\n]{6,}['"]/i],
  ['database URL with credential', /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i]
];
const failures=[];
for (const file of files) {
  if (!/\.(?:m?js|cjs|html|md|sql|ya?ml|json|txt|xml|toml|env)$/.test(file) && !path.basename(file).startsWith('.env')) continue;
  const text=await readFile(path.join(root,file),'utf8');
  for (const [label,pattern] of rules) {
    if (file.startsWith('assets/vendor/') && label === 'literal password assignment') continue;
    // Explicit dummy strings used in unit tests are not real secrets.
    const sanitized=file.startsWith('tests/') ? text.replace(/['"]test-input['"]/g,"''") : text;
    if (pattern.test(sanitized)) failures.push(`${file}: ${label}`);
  }
  for (const token of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
    try { if (JSON.parse(Buffer.from(token[1],'base64url').toString()).role==='service_role') failures.push(`${file}: service role JWT`); } catch { /* not a JWT */ }
  }
}
const context={window:{}};
vm.runInNewContext(await readFile(path.join(root,'js/comments.js'),'utf8'),context);
for (const rows of Object.values(context.window.SITE_COMMENTS || {})) {
  for (const row of rows) if (Object.keys(row).some(key=>/email|device/i.test(key))) failures.push('js/comments.js: legacy private metadata');
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exitCode=1; }
else console.log('Secret scan passed; legacy comments contain no email/device fields.');
