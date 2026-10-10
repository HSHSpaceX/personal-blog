// In-memory authority fixture, never production credentials or remote requests.
export const ids={article:'10000001-0000-4000-8000-000000000001',moment:'10000002-0000-4000-8000-000000000002',album:'10000003-0000-4000-8000-000000000003',author:'00000001-0000-4000-8000-000000000001',revision:'20000001-0000-4000-8000-000000000001',pending:'20000002-0000-4000-8000-000000000002',rejected:'20000003-0000-4000-8000-000000000003'};
export const attack='<script>window.compromised=1</script>\n<img src=x onerror="window.compromised=2"> javascript:alert(1)';
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const jpg=Buffer.from([255,216,255,224,0,0]);
const webp=Buffer.from('RIFF0000WEBP0000');
const pdf=Buffer.from('%PDF-1.7\nfixture');
const mp4=Buffer.from([0,0,0,20,...Buffer.from('ftypisom00000000')]);
const text=Buffer.from('安全纯文本附件');
const files=[['image/png','png',png],['image/jpeg','jpg',jpg],['image/webp','webp',webp],['application/pdf','pdf',pdf],['video/mp4','mp4',mp4],['text/plain','txt',text]].map(([mime,ext,bytes],i)=>({id:'3000000'+(i+1)+'-0000-4000-8000-00000000000'+(i+1),owner_id:ids.author,bucket_id:'community-assets',object_path:ids.author+'/4000000'+(i+1)+'-0000-4000-8000-00000000000'+(i+1)+'.'+ext,original_name:'resource-'+(i+1)+'.'+ext,mime_type:mime,size_bytes:bytes.length,storage_metadata:{mimetype:mime,size:bytes.length},bytes}));
export function fixture(){
 const author={username:'member_user',display_name:'投稿作者 😀 <文字>',avatar_url:'https://example.invalid/avatar.png'};
 const row=(id,revision,type,title,body,assets)=>({id,revision_id:revision,content_type:type,slug:type==='article'?'community-first-article':'c-'+id,title,body,published_at:'2026-10-07T03:00:00.000Z',author,assets:assets.map(({bytes,...a})=>a)});
 const article=row(ids.article,ids.revision,'article','社区文章 😀 <文字>',{text:attack+'\n\n'+('x'.repeat(600)),summary:'短摘要',category:'测试分类',tags:['测试标签'],asset_ids:files.map(a=>a.id)},files);
 const moment=row(ids.moment,'20000004-0000-4000-8000-000000000004','moment','社区动态',{text:attack,asset_ids:[files[0].id,files[4].id]},[files[0],files[4]]);
 const album=row(ids.album,'20000005-0000-4000-8000-000000000005','album','社区图册',{description:attack,photos:[{asset_id:files[1].id,caption:attack},{asset_id:files[2].id,caption:'第二张'}]},[files[1],files[2]]);
 const revisions=[{...article,status:'approved'}, {...article,revision_id:ids.pending,status:'pending',body:{text:'PRIVATE_PENDING',asset_ids:[]}},{...article,revision_id:ids.rejected,status:'rejected',body:{text:'PRIVATE_REJECTED',asset_ids:[]}}, {...article,revision_id:'20000006-0000-4000-8000-000000000006',status:'approved',body:{text:'PRIVATE_HISTORY',asset_ids:[]}}];
 const authority={rows:[article,moment,album],revisions,files,objects:new Map(),calls:[],results:[]};
 authority.adapter={export:async()=>structuredClone(authority.rows),download:async path=>{authority.calls.push(['download','community-assets',path]);const a=files.find(a=>a.object_path===path);if(!a)throw Error('Unexpected object');return a.bytes;},publicURL:path=>'https://fixture.supabase.invalid/storage/v1/object/public/published-media/'+path,
 uploadPublic:async(name,bytes,mime)=>{authority.calls.push(['upload','published-media',name]);authority.objects.set(name,{bytes,mime});},listPublic:async()=>[...authority.objects.keys()],removePublic:async name=>{authority.calls.push(['remove','published-media',name]);authority.objects.delete(name);},legacy:async rows=>authority.calls.push(['legacy',rows]),result:async(...args)=>authority.results.push(args)};
 return authority;
}
