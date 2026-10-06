(function () {
  'use strict';
  var auth=window.BlogAuth;
  function value(r){if(r.error)throw r.error;return r.data;}
  async function client(){await auth.ready();auth.requireUser();return auth.client();}
  async function rpc(name,args){return value(await (await client()).rpc(name,args));}
  async function getEdit(id){if(!window.CommunitySchema.uuid(id))throw Error('无效编辑链接。');var db=await client();
    var r=value(await db.from('comment_edits').select('id,comment_id,author_id,previous_content,proposed_content,status,rejection_reason,created_at').eq('id',id).maybeSingle());
    if(!r)throw Error('评论编辑不存在或无权访问。');return r;}
  async function ownComment(id){if(!window.CommunitySchema.uuid(id))throw Error('无效评论链接。');var db=await client();
    var r=value(await db.from('comments').select('id,post_slug,parent_id,content,status,created_at').eq('id',id).eq('user_id',auth.requireUser().id).maybeSingle());
    if(!r)throw Error('只能编辑自己的评论。');
    var edits=value(await db.from('comment_edits').select('id,proposed_content,status,rejection_reason').eq('comment_id',id).order('edit_no',{ascending:false}).limit(1));r.latest_edit=edits[0]||null;return r;}
  window.CommentEditData={getEdit:getEdit,ownComment:ownComment,
    mine:function(offset){return rpc('community_my_comments',{p_limit:20,p_offset:offset});},
    save:function(id,text){return rpc('community_edit_comment',{p_comment_id:id,p_content:text});},
    queue:async function(offset){auth.requireAdmin();return value(await (await client()).from('comment_edits').select('id,comment_id,author_id,previous_content,proposed_content,status,created_at').eq('status','pending').order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+19));},
    review:function(id,decision,reason){auth.requireAdmin();return rpc('community_review_comment_edit',{p_edit_id:id,p_decision:decision,p_rejection_reason:reason||null});}};
})();
