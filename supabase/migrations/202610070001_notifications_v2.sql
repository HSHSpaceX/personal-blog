-- Personal events are recipient-private. Moderation queues remain separate.
begin;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in
 ('content_approved','content_rejected','comment_approved','comment_rejected',
  'comment_edit_approved','comment_edit_rejected','content_like','comment_like',
  'content_comment','comment_reply','follow','direct_message'));
alter table public.notifications add column target_type text check(target_type in ('content','post','moment','album','profile'));
alter table public.notifications add column target_id text check(char_length(target_id) between 1 and 160);
alter table public.notifications add column comment_id uuid references public.comments(id) on delete cascade;
create index notifications_page_order on public.notifications(user_id,created_at desc,id desc);
alter table public.legacy_public_targets add column author_id uuid references public.profiles(id) on delete set null;
-- Only this trusted SQL snapshot assigns legacy ownership. Never derive owners
-- dynamically from a client-editable username or accept an owner argument.
update public.legacy_public_targets set author_id=(select p.id from public.profiles p
 join public.user_roles r on r.user_id=p.id and r.role='admin' where p.username='hshspacex');

create table public.comment_review_results (
 id uuid primary key default gen_random_uuid(), comment_id uuid not null references public.comments(id) on delete cascade,
 author_id uuid references auth.users(id) on delete cascade, reviewer_id uuid references auth.users(id) on delete set null,
 decision text not null check(decision in ('approved','rejected')), rejection_reason text,
 edit_id uuid references public.comment_edits(id) on delete set null,
 created_at timestamptz not null default now(),
 check((decision='rejected' and char_length(rejection_reason) between 1 and 2000 and char_length(btrim(rejection_reason))>0)
   or (decision='approved' and rejection_reason is null)),
 check(decision<>'rejected' or rejection_reason is not null)
);
create index comment_results_latest on public.comment_review_results(comment_id,created_at desc,id desc);
alter table public.comment_review_results enable row level security;
create policy comment_results_private on public.comment_review_results for select to authenticated
 using(author_id=(select auth.uid()) or public.is_admin());
revoke all on public.comment_review_results from public,anon,authenticated;
grant select on public.comment_review_results to authenticated;
create table public.comment_public_events (
 comment_id uuid primary key references public.comments(id) on delete cascade, created_at timestamptz not null default now()
);
alter table public.comment_public_events enable row level security;
revoke all on public.comment_public_events from public,anon,authenticated;
-- Already public comments are not new releases after installation.
insert into public.comment_public_events(comment_id) select id from public.comments where status='approved';

create function public.notification_comment_target(p_slug text) returns jsonb
language sql immutable set search_path='' as $$
 select case when p_slug like 'community-%' then jsonb_build_object('type','content','id',substr(p_slug,11))
 when p_slug like 'moment-%' then jsonb_build_object('type','moment','id',substr(p_slug,8))
 when p_slug like 'album-%' then jsonb_build_object('type','album','id',substr(p_slug,7))
 else jsonb_build_object('type','post','id',p_slug) end;
$$;
create function public.notification_content_owner(p_type text,p_id text) returns uuid
language sql stable security definer set search_path='' as $$
 select case when p_type='content' then (select i.author_id from public.content_items i
   join public.content_revisions r on r.id=i.published_revision_id and r.status='approved' where i.id::text=p_id)
 else (select author_id from public.legacy_public_targets where target_type=p_type and target_id=p_id) end;
$$;
-- Preserve approval notifications when an edited unpublished comment first
-- becomes public. The independent edit outcome remains a separate audit event.
create or replace function public.notify_comment_approved() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='approved' and old.status<>'approved' and new.user_id is not null and new.user_id is distinct from auth.uid() then
  insert into public.notifications(user_id,actor_id,type,title,body,comment_id)
  values(new.user_id,auth.uid(),'comment_approved','评论审核通过',left(new.content,200),new.id);
 end if;return new;
end; $$;
create function public.notify_initial_comment_result() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.decision='rejected' and new.author_id is not null and new.author_id is distinct from new.reviewer_id then
  insert into public.notifications(user_id,actor_id,type,title,body,comment_id)
  values(new.author_id,new.reviewer_id,'comment_'||new.decision,
    case when new.decision='approved' then '评论审核通过' else '评论被驳回，请重新编辑' end,
    coalesce(new.rejection_reason,''),new.comment_id);
 end if; return new;
end; $$;
create trigger initial_comment_result after insert on public.comment_review_results
 for each row execute function public.notify_initial_comment_result();
create or replace function public.community_review_comment_edit(p_edit_id uuid,p_decision text,p_rejection_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare cid uuid; c public.comments; e public.comment_edits;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('approved','rejected') or
 (p_decision='rejected' and (p_rejection_reason is null or char_length(p_rejection_reason)>2000 or char_length(btrim(p_rejection_reason))<1)) or
 (p_decision='approved' and p_rejection_reason is not null) then raise exception 'Invalid edit decision or rejection reason' using errcode='22023';end if;
 select comment_id into cid from public.comment_edits where id=p_edit_id;
 select * into c from public.comments where id=cid for update;
 select * into e from public.comment_edits where id=p_edit_id for update;
 if e.id is null or e.status<>'pending' then raise exception 'Only a pending edit may be reviewed' using errcode='22023';end if;
 update public.comment_edits set status=p_decision,rejection_reason=p_rejection_reason,reviewer_id=auth.uid(),resolved_at=now() where id=e.id;
 if p_decision='approved' then update public.comments set content=e.proposed_content,status='approved' where id=c.id;
 elsif c.status<>'approved' then update public.comments set status='rejected' where id=c.id;end if;
 -- Editing a never-public comment must not lose its initial decision/reason.
 -- Public edits retain the original public comment and only the edit result.
 if c.status<>'approved' then
  insert into public.comment_review_results(comment_id,author_id,reviewer_id,decision,rejection_reason,edit_id)
  values(c.id,c.user_id,auth.uid(),p_decision,p_rejection_reason,e.id);
 end if;
end; $$;
create or replace function public.community_moderate_comment(p_comment_id uuid,p_decision text,p_rejection_reason text default null,p_expected_content text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.comments; eid uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or
 (p_decision='rejected' and (p_rejection_reason is null or char_length(p_rejection_reason)>2000 or char_length(btrim(p_rejection_reason))<1)) or
 (p_decision='approved' and p_rejection_reason is not null) then raise exception 'Invalid comment decision or rejection reason' using errcode='22023'; end if;
 select * into c from public.comments where id=p_comment_id for update;
 if c.id is null then raise exception 'Comment unavailable' using errcode='22023'; end if;
 if p_expected_content is not null and c.content is distinct from p_expected_content then raise exception 'Comment changed; reload before reviewing' using errcode='22023'; end if;
 select id into eid from public.comment_edits where comment_id=c.id and status='pending';
 if eid is not null then perform public.community_review_comment_edit(eid,p_decision,p_rejection_reason);
 elsif c.status='pending' then
  update public.comments set status=p_decision where id=c.id;
  insert into public.comment_review_results(comment_id,author_id,reviewer_id,decision,rejection_reason)
  values(c.id,c.user_id,auth.uid(),p_decision,p_rejection_reason);
 elsif c.status<>p_decision then raise exception 'Only a pending comment may be reviewed' using errcode='22023';
 end if;
end; $$;
drop function public.community_my_comments(integer,integer);
create function public.community_my_comments(p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,post_slug text,parent_id uuid,content text,status text,created_at timestamptz,latest_edit jsonb,rejection_reason text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select c.id,c.post_slug,c.parent_id,c.content,c.status,c.created_at,
 (select jsonb_build_object('id',e.id,'edit_no',e.edit_no,'proposed_content',e.proposed_content,'status',e.status,'rejection_reason',e.rejection_reason)
 from public.comment_edits e where e.comment_id=c.id order by e.edit_no desc limit 1),
 (select r.rejection_reason from public.comment_review_results r where r.comment_id=c.id and r.decision='rejected'
 order by r.created_at desc,r.id desc limit 1)
 from public.comments c where c.user_id=auth.uid() order by c.created_at desc,c.id limit p_limit offset p_offset;
end; $$;
create or replace function public.notify_comment_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare reply_owner uuid; content_owner uuid; target jsonb;
begin
 if new.user_id is null or new.status<>'approved' or (tg_op='UPDATE' and old.status='approved') then return new; end if;
 insert into public.comment_public_events(comment_id) values(new.id) on conflict do nothing;
 if not found then return new; end if;
 target:=public.notification_comment_target(new.post_slug);
 if new.parent_id is not null then
  select user_id into reply_owner from public.comments where id=new.parent_id and status='approved' and post_slug=new.post_slug;
 end if;
 if reply_owner is not null and reply_owner is distinct from new.user_id then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id,comment_id)
  values(reply_owner,new.user_id,'comment_reply','收到评论回复',left(new.content,200),target->>'type',target->>'id',new.id);
 end if;
 content_owner:=public.notification_content_owner(target->>'type',target->>'id');
 if content_owner is not null and content_owner is distinct from new.user_id and content_owner is distinct from reply_owner then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id,comment_id)
  values(content_owner,new.user_id,'content_comment','你的内容收到评论',left(new.content,200),target->>'type',target->>'id',new.id);
 end if;
 return new;
end; $$;
create or replace function public.notify_comment_like() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; target jsonb; c public.comments;
begin
 if new.target_type='comment' then
  select * into c from public.comments where id::text=new.target_id and status='approved';
  owner_id:=c.user_id;target:=public.notification_comment_target(c.post_slug);
 else owner_id:=public.notification_content_owner(new.target_type,new.target_id);
  target:=jsonb_build_object('type',new.target_type,'id',new.target_id);
 end if;
 if owner_id is not null and owner_id is distinct from new.user_id then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id,comment_id)
  values(owner_id,new.user_id,case when new.target_type='comment' then 'comment_like' else 'content_like' end,
  case when new.target_type='comment' then '评论被点赞' else '你的内容被点赞' end,'',target->>'type',target->>'id',c.id);
 end if; return new;
end; $$;
create or replace function public.notify_follow() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.follower_id is distinct from new.target_id then
  insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
  values(new.target_id,new.follower_id,'follow','收到新关注','','profile',new.follower_id::text);
 end if; return new;
end; $$;
create or replace function public.community_notify_review_result() returns trigger language plpgsql security definer set search_path='' as $$
declare author uuid;
begin
 if old.status='pending' and new.status in ('approved','rejected') and new.decision_source='admin' then
  select author_id into author from public.content_items where id=new.item_id;
  if author is not null and author is distinct from new.reviewer_id then
   insert into public.notifications(user_id,actor_id,type,title,body,revision_id,target_type,target_id)
   values(author,new.reviewer_id,'content_'||new.status,
    case when new.status='approved' then '内容审核通过' else '内容被驳回，请重新编辑' end,
    coalesce(new.rejection_reason,''),new.revision_id,'content',new.item_id::text);
  end if;
 end if;return new;
end; $$;
create or replace function public.community_notify_comment_edit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status in ('approved','rejected') and new.author_id is distinct from new.reviewer_id then
  insert into public.notifications(user_id,actor_id,type,title,body,comment_edit_id,comment_id)
  values(new.author_id,new.reviewer_id,'comment_edit_'||new.status,
   case when new.status='approved' then '评论修改已通过' else '评论修改被驳回，请重新编辑' end,coalesce(new.rejection_reason,''),new.id,new.comment_id);
 end if;return new;
end; $$;
create function public.notification_unread_count(p_include_dm boolean default true) returns bigint
language sql stable security definer set search_path='' as $$
 select count(*) from public.notifications where user_id=auth.uid() and not read and (p_include_dm or type<>'direct_message');
$$;
create function public.community_public_comments(p_item_id uuid,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,author_id uuid,parent_id uuid,content text,created_at timestamptz,username text,display_name text,avatar_url text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.community_check_page(p_limit,p_offset);
 if public.community_public_target('content',p_item_id::text) is null then return;end if;
 return query select c.id,c.user_id,c.parent_id,c.content,c.created_at,p.username,p.display_name,p.avatar_url
 from public.comments c left join public.profiles p on p.id=c.user_id
 where c.post_slug='community-'||p_item_id::text and c.status='approved'
 order by c.created_at desc,c.id desc limit p_limit offset p_offset;
end; $$;
create function public.notification_mark_read(p_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 update public.notifications set read=true where user_id=auth.uid() and not read and (p_id is null or id=p_id);
end; $$;
revoke all on function public.notification_comment_target(text),public.notification_content_owner(text,text),public.notify_initial_comment_result()
 from public,anon,authenticated;
revoke all on function public.community_my_comments(integer,integer),public.notification_unread_count(boolean),public.notification_mark_read(uuid)
 from public,anon,authenticated;
grant execute on function public.community_my_comments(integer,integer),public.notification_unread_count(boolean),public.notification_mark_read(uuid) to authenticated;
revoke all on function public.community_public_comments(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.community_public_comments(uuid,integer,integer) to anon,authenticated;
commit;
