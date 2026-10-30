// Offline only. Immutable originals + checksum-verified removal of managed DDL.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Storage_Transform23,Storage_ForwardRepair,Storage_BoundaryGuard,Storage_Contract,storageSources} from './storage-compatibility.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reviewed={
 '202610060004_private_assets.sql':['f7f447ef68f3def71fa3d6cc4d4a46b6dbb152e8cc084caf06741f44d5e5c161',['community_assets_immutable']],
 '202610060008_resource_center.sql':['f9ca7d118f948f611f7c20d6f4e67b5f9d992ad5aa2327b4d73da7cdb83a341d',['community_orphan_delete_guard','community_delete_intent_cleanup']],
 '202610070002_direct_messages.sql':['c1669b6400f28cac228aefb44e8a45b7e227c414b33721fec26366e26758b64b',['dm_media_immutable','dm_media_orphan_guard','dm_media_delete_cleanup']]
};
const hash=s=>createHash('sha256').update(s).digest('hex');
export function Install_Transform(name,source){
 let sql=source.replace(/\r\n/g,'\n'),entry=reviewed[name];
 if(name==='202610130001_storage_compatibility.sql')return Storage_Transform23(sql);
 if(!entry)return sql;
 if(hash(sql)!==entry[0])throw Error('Historical SQL checksum changed: '+name+'; review before generating compatibility install');
 for(const trigger of entry[1]){const pattern=new RegExp('create trigger '+trigger+' [\\s\\S]*?execute function public\\.[a-z_]+\\(\\);');if(!pattern.test(sql))throw Error('Missing reviewed trigger '+trigger);sql=sql.replace(pattern,'-- Managed trigger '+trigger+' replaced by 202610130001 application protections.');}
 if(name==='202610070002_direct_messages.sql')sql=sql.replace("create unique index dm_media_object_path on storage.objects(bucket_id,name) where bucket_id='dm-media';",'-- Uses native current-row path uniqueness, checked by the compatible migration 23.');
 return sql;
}
export async function Install_Build(directory){
 await mkdir(directory,{recursive:true});const manifest=[];let bundle='-- FRESH EMPTY APPLICATION SCHEMA ONLY. One transaction, no production automation.\nbegin;\n';
 for(const name of (await readdir(path.join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort()){
  const original=(await readFile(path.join(root,'supabase/migrations',name),'utf8')).replace(/\r\n/g,'\n'),sql=Install_Transform(name,original);
  manifest.push({file:name,source_lf_sha256:hash(original),install_lf_sha256:hash(sql),removed_managed_triggers:reviewed[name]?.[1]||[],replacement:reviewed[name]?'202610130001_storage_compatibility.sql':null,
   compatibility_overlay:name==='202610130001_storage_compatibility.sql'?'20261030-current-objects':null});
  if(reviewed[name]||name==='202610130001_storage_compatibility.sql')await writeFile(path.join(directory,name),sql);
  bundle+='\n-- SOURCE '+name+' SHA256(LF) '+hash(original)+'\n'+sql.replace(/^\s*(?:begin|commit);\s*$/gmi,'');
 }
 bundle+='\ncommit;\n';await writeFile(path.join(directory,'fresh-install.sql'),bundle);await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const extra={'repair-applied-23.sql':Storage_ForwardRepair(),'diagnose-boundary-22.sql':'begin transaction read only;\n'+Storage_BoundaryGuard()+Storage_Contract()+'\nrollback;\n'};
 for(const [name,sql] of Object.entries(extra))await writeFile(path.join(directory,name),sql);
 const artifacts=[];
 for(const name of ['fresh-install.sql','202610130001_storage_compatibility.sql',...Object.keys(extra)])artifacts.push({file:name,lf_sha256:hash((await readFile(path.join(directory,name),'utf8')).replace(/\r\n/g,'\n'))});
 const sources=[];
 for(const name of ['scripts/storage-compatibility.mjs','scripts/build-compatible-install.mjs','supabase/compatibility/boundary-inventory.sql','supabase/compatibility/boundaries.json','supabase/compatibility/storage-contract.sql','supabase/compatibility/current-object-helpers.sql'])sources.push({file:name,lf_sha256:hash((await readFile(path.join(root,name),'utf8')).replace(/\r\n/g,'\n'))});
 await writeFile(path.join(directory,'storage-compatibility-manifest.json'),JSON.stringify({version:20261030,history:storageSources,sources,artifacts,production_database_migrated:false},null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=process.argv[process.argv.indexOf('--output')+1];if(!process.argv.includes('--output')||!output)throw Error('Use --output <local-directory>');await Install_Build(path.resolve(output));console.log('Offline compatible install generated; originals unchanged. Existing/partial databases must use the preflight routing guide, never fresh-install.sql.');
}
