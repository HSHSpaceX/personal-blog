// Maintainer-only offline reference generation. Never connects to an external DB.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNativeDatabase} from '../tests/helpers/native-postgres.mjs';
const root=new URL('../',import.meta.url);
const db=await createNativeDatabase({through:'202610110004_idempotent_messages.sql'});
try {
 const query=await readFile(new URL('supabase/compatibility/boundary-inventory.sql',root),'utf8');
 const result={sources:{},boundaries:{},compatible_v1:{}};
 const names=(await readdir(new URL('supabase/migrations/',root))).filter(n=>n.endsWith('.sql')).sort();
 for(const name of names)result.sources[name]=createHash('sha256').update((await readFile(new URL('supabase/migrations/'+name,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
 let previous={};
 for(let boundary=22;boundary<=27;boundary++){
  if(boundary>22)await db.exec(await readFile(new URL('supabase/migrations/'+names[boundary-1],root),'utf8'));
  const current=Object.fromEntries((await db.query(query)).rows.map(r=>[r.key,r.digest]));
  result.boundaries[boundary]=Object.fromEntries(Object.keys({...previous,...current}).filter(k=>previous[k]!==current[k]).map(k=>[k,current[k]??null]));
  previous=current;
 }
 const v1=await createNativeDatabase({through:'202610130001_storage_compatibility.sql'});
 try{
  const source=(await readFile(new URL('tests/fixtures/storage/runtime-v1.sql',root),'utf8')).replace(/\r\n/g,'\n');
  result.compatible_v1_source_sha256=createHash('sha256').update(source).digest('hex');
  if(result.compatible_v1_source_sha256!=='154f1edeb0dc34c7d8b88dc7df496721ec997fc3f5f4d715881a1ee5c1c16958')throw Error('Frozen v1 fixture changed');
  await v1.exec(source);
  // V1 overrides are relative to the corresponding historical boundary.
  let historical={};
  for(let boundary=22;boundary<=27;boundary++){
   historical={...historical,...result.boundaries[boundary]};
   for(const key of Object.keys(historical))if(historical[key]===null)delete historical[key];
   if(boundary===22)continue;
   if(boundary>23)await v1.exec(await readFile(new URL('supabase/migrations/'+names[boundary-1],root),'utf8'));
   const current=Object.fromEntries((await v1.query(query)).rows.map(r=>[r.key,r.digest]));
   result.compatible_v1[boundary]=Object.fromEntries(Object.keys({...historical,...current}).filter(k=>historical[k]!==current[k]).map(k=>[k,current[k]??null]));
  }
 }finally{await v1.close();}
 await writeFile(new URL('supabase/compatibility/boundaries.json',root),JSON.stringify(result,null,2)+'\n');
} finally {await db.close();}
