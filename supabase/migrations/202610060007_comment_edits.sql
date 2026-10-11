-- Public comment body stays stable while independent private edits are reviewed.
begin;
create table public.comment_edits (
 id uuid primary key default gen_random_uuid(), comment_id uuid not null references public.comments(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 edit_no integer not null check(edit_no>0), unique(comment_id,edit_no),
 previous_content text not null, proposed_content text not null check(char_length(proposed_content)<=2000 and char_length(btrim(proposed_content))>=1),
 status text not null check(status in ('pending','approved','rejected','superseded')),
 decision_source text not null check(decision_source in ('admin','admin_auto')),
 rejection_reason text check(char_length(rejection_reason) between 1 and 2000 and char_length(btrim(rejection_reason))>=1),
 reviewer_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), resolved_at timestamptz,
 check((status='rejected' and rejection_reason is not null) or (status<>'rejected' and rejection_reason is null))
);
create unique index comment_one_pending_edit on public.comment_edits(comment_id) where status='pending';
create index comment_edits_author on public.comment_edits(author_id,created_at desc,id);
alter table public.comment_edits enable row level security;
create policy comment_edits_private on public.comment_edits for select to authenticated
 using(author_id=(select auth.uid()) or public.is_admin());
revoke all on public.comment_edits from public,anon,authenticated;
grant select on public.comment_edits to authenticated;
-- Remove both table and column UPDATE grants. Existing moderator UI uses RPC.
revoke update on public.comments from public,anon,authenticated;
revoke update(id,post_slug,user_id,parent_id,legacy_author_name,content,status,created_at,updated_at)
 on public.comments from public,anon,authenticated;
create function public.community_edit_comment(p_comment_id uuid,p_content text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.comments; eid uuid;
begin
 select * into c from public.comments where id=p_comment_id for update;
 if auth.uid() is null or c.id is null or c.user_id is distinct from auth.uid() then raise exception 'Comment unavailable' using errcode='42501'; end if;
 if p_content is null or char_length(p_content)>2000 or char_length(btrim(p_content))<1 then raise exception 'Invalid comment text' using errcode='22023'; end if;
 if c.status='approved' and not public.is_admin() and exists(select 1 from public.comment_edits where comment_id=c.id and status='pending') then
   raise exception 'A comment already has a pending edit' using errcode='22023'; end if;
 -- Unpublished pending comments can be revised again: close the old candidate
 -- as superseded, keep its immutable text/history, and create exactly one new edit.
 update public.comment_edits set status='superseded',resolved_at=now() where comment_id=c.id and status='pending';
 insert into public.comment_edits(comment_id,author_id,edit_no,previous_content,proposed_content,status,decision_source,reviewer_id,resolved_at)
 values(c.id,auth.uid(),(select coalesce(max(edit_no),0)+1 from public.comment_edits where comment_id=c.id),c.content,p_content,case when public.is_admin() then 'approved' else 'pending' end,
   case when public.is_admin() then 'admin_auto' else 'admin' end,case when public.is_admin() then auth.uid() else null end,
   case when public.is_admin() then now() else null end) returning id into eid;
 if public.is_admin() then update public.comments set content=p_content,status='approved' where id=c.id;
 elsif c.status<>'approved' then update public.comments set content=p_content,status='pending' where id=c.id;
 end if;
 return eid;
end; $$;
create function public.community_review_comment_edit(p_edit_id uuid,p_decision text,p_rejection_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare cid uuid; c public.comments; e public.comment_edits;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or
 (p_decision='rejected' and (p_rejection_reason is null or char_length(p_rejection_reason)>2000 or char_length(btrim(p_rejection_reason))<1)) or
 (p_decision='approved' and p_rejection_reason is not null) then raise exception 'Invalid edit decision or rejection reason' using errcode='22023'; end if;
 select comment_id into cid from public.comment_edits where id=p_edit_id;
 select * into c from public.comments where id=cid for update;
 select * into e from public.comment_edits where id=p_edit_id for update;
 if e.id is null or e.status<>'pending' then raise exception 'Only a pending edit may be reviewed' using errcode='22023'; end if;
 update public.comment_edits set status=p_decision,rejection_reason=p_rejection_reason,reviewer_id=auth.uid(),resolved_at=now() where id=e.id;
 if p_decision='approved' then update public.comments set content=e.proposed_content,status='approved' where id=c.id;
 elsif c.status<>'approved' then update public.comments set status='rejected' where id=c.id;
 end if;
end; $$;
create function public.community_moderate_comment(p_comment_id uuid,p_decision text,p_rejection_reason text default null,p_expected_content text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.comments; eid uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid moderation decision' using errcode='22023'; end if;
 select * into c from public.comments where id=p_comment_id for update;
 if c.id is null then raise exception 'Comment unavailable' using errcode='22023'; end if;
 if p_expected_content is not null and c.content is distinct from p_expected_content then raise exception 'Comment changed; reload before reviewing' using errcode='22023'; end if;
 select id into eid from public.comment_edits where comment_id=c.id and status='pending';
 if eid is not null then perform public.community_review_comment_edit(eid,p_decision,p_rejection_reason);
 else update public.comments set status=p_decision where id=c.id; end if;
end; $$;
create function public.community_my_comments(p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,post_slug text,parent_id uuid,content text,status text,created_at timestamptz,latest_edit jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select c.id,c.post_slug,c.parent_id,c.content,c.status,c.created_at,
 (select jsonb_build_object('id',e.id,'edit_no',e.edit_no,'proposed_content',e.proposed_content,'status',e.status,'rejection_reason',e.rejection_reason)
  from public.comment_edits e where e.comment_id=c.id order by e.edit_no desc limit 1)
 from public.comments c where c.user_id=auth.uid() order by c.created_at desc,c.id limit p_limit offset p_offset;
end; $$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in
 ('comment_approved','comment_reply','comment_like','follow','content_approved','content_rejected','comment_edit_approved','comment_edit_rejected'));
alter table public.notifications add column comment_edit_id uuid references public.comment_edits(id) on delete cascade;
create unique index notifications_comment_edit_decision on public.notifications(comment_edit_id) where comment_edit_id is not null;
create function public.community_notify_comment_edit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status in ('approved','rejected') and new.author_id is distinct from new.reviewer_id then
 insert into public.notifications(user_id,actor_id,type,title,body,comment_edit_id)
 values(new.author_id,new.reviewer_id,'comment_edit_'||new.status,
   case when new.status='approved' then '评论修改已通过' else '评论修改被驳回，请重新编辑' end,coalesce(new.rejection_reason,''),new.id);
 end if; return new;
end; $$;
create trigger comment_edit_result after update of status on public.comment_edits for each row execute function public.community_notify_comment_edit();
revoke all on function public.community_notify_comment_edit() from public,anon,authenticated;
revoke all on function public.community_edit_comment(uuid,text),public.community_review_comment_edit(uuid,text,text),
 public.community_moderate_comment(uuid,text,text,text),public.community_my_comments(integer,integer) from public,anon,authenticated;
grant execute on function public.community_edit_comment(uuid,text),public.community_review_comment_edit(uuid,text,text),
 public.community_moderate_comment(uuid,text,text,text),public.community_my_comments(integer,integer) to authenticated;
commit;
