// Maintainer-only offline reference generation. Never connects to an external DB.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNativeDatabase} from '../tests/helpers/native-postgres.mjs';
const root=new URL('../',import.meta.url);
const db=await createNativeDatabase({through:'202610110004_idempotent_messages.sql'});
try {
 const query=await readFile(new URL('supabase/compatibility/boundary-inventory.sql',root),'utf8');
 const result={sources:{},boundaries:{}};
 const names=(await readdir(new URL('supabase/migrations/',root))).filter(n=>n.endsWith('.sql')).sort();
 for(const name of names)result.sources[name]=createHash('sha256').update((await readFile(new URL('supabase/migrations/'+name,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
 let previous={};
 for(let boundary=22;boundary<=27;boundary++){
  if(boundary>22)await db.exec(await readFile(new URL('supabase/migrations/'+names[boundary-1],root),'utf8'));
  const current=Object.fromEntries((await db.query(query)).rows.map(r=>[r.key,r.digest]));
  result.boundaries[boundary]=Object.fromEntries(Object.keys({...previous,...current}).filter(k=>previous[k]!==current[k]).map(k=>[k,current[k]??null]));
  previous=current;
 }
 await writeFile(new URL('supabase/compatibility/boundaries.json',root),JSON.stringify(result,null,2)+'\n');
} finally {await db.close();}
