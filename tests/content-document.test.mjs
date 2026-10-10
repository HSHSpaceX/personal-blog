import {test} from 'node:test';
import assert from 'node:assert/strict';
import schema from '../js/community-schema.js';
import publicData from '../js/community-public.js';
import {createDatabase,seedActors,asActor,actors,modulePath} from './helpers/postgres.mjs';
const hostile='<script>window.compromised=1</script><svg onload=alert(1)>';
const document={version:1,blocks:[{type:'heading',level:2,runs:[{text:'标题'}]},{type:'paragraph',runs:[{text:hostile,marks:['bold','italic']},{text:'链接',href:'https://example.org/read?q=1'}]},{type:'list',ordered:true,items:[[{text:'第一项'}],[{text:'第二项'}]]},{type:'quote',runs:[{text:'引用'}]},{type:'code',runs:[{text:'const a = 1;'}]}]};
const body={text:schema.documentText(document),document,category:'杂谈',tags:['记录'],asset_ids:[]};
function changed(fn){const b=structuredClone(body);fn(b);return b;}
const attacks=[
 changed(b=>b.document.version=2),changed(b=>b.document.html=hostile),changed(b=>b.document.blocks[0].style='x'),
 changed(b=>b.document.blocks[0].level=1),changed(b=>b.document.blocks.push({type:'iframe',src:'https://evil.invalid'})),
 changed(b=>b.document.blocks[1].runs[0].onerror='x'),changed(b=>b.document.blocks[1].runs[0].marks=['underline']),
 changed(b=>b.document.blocks[1].runs[0].marks=['bold','bold']),changed(b=>b.document.blocks[1].runs[1].href='javascript:alert(1)'),
 changed(b=>b.document.blocks[1].runs[1].href='data:text/html,x'),changed(b=>b.document.blocks[1].runs[1].href='https://user:pass@example.org'),
 changed(b=>b.document.blocks[1].runs[1].href='https://example.org/\nattack'),changed(b=>b.document.blocks[1].runs[1].href='//example.org'),changed(b=>b.document.blocks[1].runs[1].href='https://example.org:99999'),
 changed(b=>b.document.blocks.push({type:'asset',asset_id:actors.other})),changed(b=>b.cover_asset_id=actors.other),
 changed(b=>b.text='different public/search text'),changed(b=>b.document.blocks=Array(201).fill(b.document.blocks[0]))
];
test('safe document serializes headings, paragraphs, lists, marks, links and inert hostile text; plain revisions stay compatible',()=>{
 assert.deepEqual(schema.validate('article','Title',body),[]);
 const html=publicData.articleHTML({content_type:'article',title:'Title',body,assets:[]});
 assert.match(html,/<h2>标题<\/h2>/);assert.match(html,/<ol><li>第一项/);assert.match(html,/<em><strong>&lt;script&gt;/);
 assert.doesNotMatch(html,/<script|<svg|onload="/);assert.match(html,/rel="noopener noreferrer nofollow"/);
 for(const b of attacks)assert.throws(()=>schema.validate('article','Title',b));
 assert.deepEqual(schema.validate('article','Old',{text:hostile}),[]);assert.match(publicData.articleHTML({body:{text:hostile},assets:[]}),/&lt;script&gt;/);
 assert.throws(()=>schema.validate('moment','Title',changed(b=>{b.text='x'.repeat(2001);delete b.document;delete b.category;delete b.tags;})));
 assert.deepEqual(schema.validate('album','Album',{description:'说明',document:{version:1,blocks:[{type:'paragraph',runs:[{text:'说明'}]}]},photos:[{asset_id:actors.user,caption:'图片'}]}),[actors.user]);
});
test('PostgreSQL independently rejects unsafe documents and unowned assets; immutable revisions, manual review and admin flow survive', {skip:!modulePath&&'Configure isolated PGlite.'},async()=>{
 const db=await createDatabase();try{await seedActors(db);
 const run=(id,sql,args=[])=>asActor(db,id?'authenticated':'anon',id,sql,args);
 const create=async(id,slug)=>(await run(id,'select public.community_create_item($1,$2) id',['article',slug])).rows[0].id;
 const save=async(id,item,b)=>(await run(id,'select public.community_save_revision($1,$2,$3) id',[item,'Title',b])).rows[0].id;
 const item=await create(actors.user,'safe-document');
 for(const b of attacks)await assert.rejects(save(actors.user,item,b),/Invalid|Unsafe|Unknown|Document|Duplicate/i);
 await assert.rejects(run(null,'select public.community_validate_body($1,$2)',['article',body]),/permission denied/);
 const revision=await save(actors.user,item,body);await run(actors.user,'select public.community_submit_revision($1)',[revision]);
 assert.equal((await run(actors.user,'select status from public.content_revisions where id=$1',[revision])).rows[0].status,'pending');
 await assert.rejects(run(actors.other,'select public.community_save_revision($1,$2,$3)',[item,'Intruder',body]),/Content unavailable/);
 await assert.rejects(run(actors.user,'update public.content_revisions set body=$1 where id=$2',[{text:'mutated'},revision]),/permission denied|immutable/i);
 await assert.rejects(run(actors.admin,'select public.community_review_revision($1,$2,$3)',[revision,'rejected','']),/reason/i);
 await run(actors.admin,'select public.community_review_revision($1,$2,$3)',[revision,'approved',null]);
 const edit=await save(actors.user,item,body);await run(actors.user,'select public.community_submit_revision($1)',[edit]);
 assert.equal((await run(actors.user,'select published_revision_id from public.content_items where id=$1',[item])).rows[0].published_revision_id,revision);
 assert.equal((await run(actors.user,'select status from public.content_revisions where id=$1',[edit])).rows[0].status,'pending');
 const adminItem=await create(actors.admin,'admin-safe-document'),adminRevision=await save(actors.admin,adminItem,body);await run(actors.admin,'select public.community_submit_revision($1)',[adminRevision]);
 assert.equal((await run(actors.admin,'select status from public.content_revisions where id=$1',[adminRevision])).rows[0].status,'approved');
 for(const [mime,extension] of [['image/png','png'],['application/pdf','pdf']]){const objectPath=actors.user+'/cover-fixture.'+extension;await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['community-assets',objectPath,{mimetype:mime,size:100}]);const registered=(await run(actors.user,'select public.community_register_asset($1,$2) id',[objectPath,'cover.'+extension])).rows[0].id;const covered=changed(b=>{b.asset_ids=[registered];b.cover_asset_id=registered;});if(mime==='image/png')await save(actors.user,item,covered);else await assert.rejects(save(actors.user,item,covered),/Invalid cover image/);}
 const ownRefs=changed(b=>{b.asset_ids=[actors.other];b.document.blocks.push({type:'asset',asset_id:actors.other});});await assert.rejects(save(actors.user,item,ownRefs),/asset|Asset/);
 }finally{await db.close();}
});
