import {cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function Fixture_CopySite(source,destination){
 const root=source instanceof URL?fileURLToPath(source):path.resolve(source);
 await cp(root,destination,{recursive:true,filter:entry=>!path.relative(root,entry).split(path.sep).some(part=>['.git','node_modules','work'].includes(part))});
}
