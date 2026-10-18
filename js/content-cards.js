/* Shared management presentation; publication is confirmed by the deployed snapshot. */
(function(){
 'use strict';
 function Content_Node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 function Content_CreateCard(item,revision){
  var card=Content_Node('article',undefined,'community-row content-card glass-card'),head=Content_Node('div',undefined,'content-card-head'),meta=Content_Node('div',undefined,'content-card-meta'),actions=Content_Node('div',undefined,'content-card-actions');
  var deployed=((window.COMMUNITY_PUBLIC||{}).items||[]).find(function(p){return p.id===item.id;}),publication=Array.isArray(item.community_publication_state)?item.community_publication_state[0]:item.community_publication_state;
  var state=revision?revision.status:'draft',labels={draft:'草稿',pending:'待审核',approved:'已批准，等待同步',rejected:'退回修改'};
  if(revision&&state==='approved'&&deployed&&deployed.revision_id===revision.id)state='public';
  else if(revision&&state==='approved'&&publication&&publication.status==='failed')state='failed';
  else if(revision&&state==='approved'&&publication&&publication.status==='published'&&publication.published_revision_id===revision.id)state='synced';
  labels.public='已公开';labels.failed='发布失败';labels.synced='已同步仓库，等待部署';
  card.dataset.itemId=item.id||'';card.dataset.contentState=state;
  head.append(Content_Node('h3',revision?revision.title:item.draft_title||item.slug||'未完成作品'),Content_Node('span',labels[state]||state,'content-state'));
  card.appendChild(head);
  var body=revision&&revision.body||{},publicBody=deployed&&deployed.body||{},summary=revision&&revision.summary||body.summary||body.text||body.description||publicBody.summary||publicBody.text||publicBody.description;
  if(summary)card.appendChild(Content_Node('p',String(summary).slice(0,120),'content-card-summary'));
  meta.appendChild(Content_Node('span',({article:'文章',moment:'动态',album:'图册'}[item.content_type]||'内容')+(revision&&revision.revision_no?' · 版本 '+revision.revision_no:'')));
  var date=revision&&revision.created_at||item.created_at;if(date&&!isNaN(Date.parse(date))){var time=Content_Node('time',new Date(date).toLocaleDateString('zh-CN'));time.dateTime=date;meta.appendChild(time);}
  if(deployed&&(!revision||deployed.revision_id!==revision.id))meta.appendChild(Content_Node('span','已有公开版本仍可见'));
  card.appendChild(meta);
  if(revision&&revision.rejection_reason)card.appendChild(Content_Node('p','退回原因：'+revision.rejection_reason,'content-card-note'));
  if(state==='failed')card.appendChild(Content_Node('p','同步失败，等待重试'+(publication.last_error?' · '+publication.last_error:''),'content-card-note'));
  card.appendChild(actions);return {element:card,actions:actions};
 }
 window.ContentCards={card:Content_CreateCard};
})();
