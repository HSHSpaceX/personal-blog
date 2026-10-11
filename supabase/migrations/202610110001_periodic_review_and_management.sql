-- Forward only. Old threshold/credit records remain an immutable historical audit.
begin;
create table public.content_review_cycles (
 user_id uuid not null references auth.users(id) on delete cascade,
 content_type text not null check(content_type in ('article','moment','album')),
 review_every integer not null default 1 check(review_every between 1 and 10000),
 first_publish_count bigint not null default 0 check(first_publish_count>=0),
 review_due boolean not null default false, gate_item_id uuid,
 updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(),
 primary key(user_id,content_type)
);
create table public.content_first_publications (
 item_id uuid primary key references public.content_items(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 content_type text not null check(content_type in ('article','moment','album')),
 approved_revision_id uuid not null, approved_at timestamptz not null default now()
);
create table public.community_management_audit (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
 action text not null, item_id uuid, revision_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.content_revision_trash (
 revision_id uuid primary key references public.content_revisions(id) on delete cascade,
 item_id uuid not null references public.content_items(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, reason text not null,
 trashed_at timestamptz not null default now(), restored_at timestamptz, restored_by uuid references auth.users(id) on delete set null
);
alter table public.content_items add column featured boolean not null default false;
alter table public.content_reviews add column review_outcome text check(review_outcome in ('approved','returned','trashed'));
-- Seed actual first approvals (automatic AND manual), never the old manual credits.
insert into public.content_first_publications(item_id,user_id,content_type,approved_revision_id,approved_at)
 select distinct on(i.id) i.id,i.author_id,i.content_type,r.id,coalesce(r.resolved_at,r.created_at)
 from public.content_items i join public.content_revisions r on r.item_id=i.id and r.status='approved'
 order by i.id,r.revision_no;
insert into public.content_review_cycles(user_id,content_type,first_publish_count)
 select user_id,content_type,count(*) from public.content_first_publications group by user_id,content_type;
-- All migrated policies default to N=1. Do not interpret threshold 0/NULL as a cycle.
insert into public.community_management_audit(action,details)
 select 'period_policy_migration',jsonb_build_object('old_thresholds',coalesce(jsonb_agg(to_jsonb(t)),'[]'),'new_default_every',1)
 from public.user_review_thresholds t;
alter table public.content_review_cycles enable row level security;
alter table public.content_first_publications enable row level security;
alter table public.community_management_audit enable row level security;
alter table public.content_revision_trash enable row level security;
create policy cycles_admin_read on public.content_review_cycles for select to authenticated using(public.is_admin());
create policy first_publications_admin_read on public.content_first_publications for select to authenticated using(public.is_admin());
create policy management_audit_admin_read on public.community_management_audit for select to authenticated using(public.is_admin());
create policy trash_private_read on public.content_revision_trash for select to authenticated using(public.is_admin() or exists(select 1 from public.content_items i where i.id=item_id and i.author_id=auth.uid()));
revoke all on public.content_review_cycles,public.content_first_publications,public.community_management_audit,public.content_revision_trash from public,anon,authenticated;
grant select on public.content_review_cycles,public.content_first_publications,public.community_management_audit,public.content_revision_trash to authenticated;

create function public.community_cycle_lock(p_user uuid,p_type text) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.content_review_cycles(user_id,content_type) values(p_user,p_type) on conflict do nothing;
 perform 1 from public.content_review_cycles where user_id=p_user and content_type=p_type for update;
end; $$;
create function public.community_record_first_publication(p_item uuid,p_revision uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i public.content_items;
begin
 select * into strict i from public.content_items where id=p_item;
 insert into public.content_first_publications(item_id,user_id,content_type,approved_revision_id)
 values(i.id,i.author_id,i.content_type,p_revision) on conflict do nothing;
 if found then
  update public.content_review_cycles set first_publish_count=first_publish_count+1,
   review_due=false,gate_item_id=null where user_id=i.author_id and content_type=i.content_type;
 end if;
end; $$;
create function public.community_set_review_cycle(p_user_id uuid,p_content_type text,p_every integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_every is null or p_every not between 1 and 10000 then raise exception 'Cycle must be 1 to 10000' using errcode='22023';end if;
 perform public.community_cycle_lock(p_user_id,p_content_type);
 update public.content_review_cycles set review_every=p_every,updated_by=auth.uid(),updated_at=now()
 where user_id=p_user_id and content_type=p_content_type;
 insert into public.community_management_audit(actor_id,action,details) values(auth.uid(),'set_review_cycle',jsonb_build_object('user',p_user_id,'type',p_content_type,'every',p_every));
end; $$;
-- Prevent an old client from silently applying the inverse policy.
create or replace function public.community_set_user_review_threshold(p_user_id uuid,p_content_type text,p_threshold integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 raise exception 'Obsolete threshold policy; use community_set_review_cycle' using errcode='22023';
end; $$;
create function public.community_review_cycle_status(p_user_id uuid)
returns table(content_type text,review_every integer,first_publish_count bigint,until_review bigint,review_due boolean,gate_item_id uuid)
language sql stable security definer set search_path='' as $$
 select t.kind,coalesce(c.review_every,1),coalesce(c.first_publish_count,0),
 case when coalesce(c.review_due,false) then 0 else coalesce(c.review_every,1)-mod(coalesce(c.first_publish_count,0),coalesce(c.review_every,1)) end,
 coalesce(c.review_due,false),c.gate_item_id from (values('article'),('moment'),('album')) t(kind)
 left join public.content_review_cycles c on c.user_id=p_user_id and c.content_type=t.kind where auth.uid() is not null and public.is_admin();
$$;
create or replace function public.community_submit_revision(p_revision_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.content_items; rev public.content_revisions; cycle public.content_review_cycles;
 target uuid; owner uuid; kind text; fresh boolean; auto_publish boolean; source text; snapshot jsonb;
begin
 select i.id,i.author_id,i.content_type into target,owner,kind from public.content_revisions r join public.content_items i on i.id=r.item_id where r.id=p_revision_id;
 if auth.uid() is null or owner is distinct from auth.uid() then raise exception 'Content unavailable' using errcode='42501';end if;
 -- Global order: user/type cycle, item, revision. Review/config/restore use the same order.
 perform public.community_cycle_lock(owner,kind);
 select * into item from public.content_items where id=target for update;
 select * into rev from public.content_revisions where id=p_revision_id for update;
 if rev.status<>'draft' or exists(select 1 from public.content_revisions where id=item.published_revision_id and revision_no>=rev.revision_no) then raise exception 'Only a newer draft may be submitted' using errcode='22023';end if;
 if exists(select 1 from public.content_revisions where item_id=item.id and status='pending') then raise exception 'An item already has a pending revision' using errcode='22023';end if;
 if exists(select 1 from public.content_revision_trash where item_id=item.id and restored_at is null) then raise exception 'Restore from trash requires an administrator' using errcode='42501';end if;
 perform public.community_validate_body(item.content_type,rev.body);
 select * into strict cycle from public.content_review_cycles where user_id=owner and content_type=kind;
 fresh:=not exists(select 1 from public.content_first_publications where item_id=item.id);
 auto_publish:=public.is_admin() or (fresh and not cycle.review_due and mod(cycle.first_publish_count+1,cycle.review_every)<>0);
 if fresh and not auto_publish then
  update public.content_review_cycles set review_due=true,gate_item_id=coalesce(gate_item_id,item.id) where user_id=owner and content_type=kind;
 end if;
 source:=case when public.is_admin() then 'admin_auto' when auto_publish then 'policy' else 'admin' end;
 snapshot:=jsonb_build_object('content_type',kind,'is_new_item',fresh,'review_every',cycle.review_every,'first_publish_count',cycle.first_publish_count,'review_due',cycle.review_due,'requires_review',not auto_publish);
 update public.content_revisions set status=case when auto_publish then 'approved' else 'pending' end,submitted_at=now(),resolved_at=case when auto_publish then now() end where id=p_revision_id;
 insert into public.content_reviews(item_id,revision_id,status,decision_source,policy_snapshot,reviewer_id,resolved_at,review_outcome)
 values(item.id,p_revision_id,case when auto_publish then 'approved' else 'pending' end,source,snapshot,case when source='admin_auto' then auth.uid() end,case when auto_publish then now() end,case when auto_publish then 'approved' end);
 if auto_publish then
  perform public.community_record_first_publication(item.id,p_revision_id);
  update public.content_items set published_revision_id=p_revision_id where id=item.id;
 end if;
end; $$;
create or replace function public.community_review_revision(p_revision_id uuid,p_decision text,p_rejection_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.content_items; rev public.content_revisions; cycle public.content_review_cycles; target uuid; owner uuid; kind text; fresh boolean; result text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('approved','returned','trashed','rejected') or (p_decision<>'approved' and (p_rejection_reason is null or char_length(btrim(p_rejection_reason)) not between 1 and 2000)) or (p_decision='approved' and p_rejection_reason is not null) then raise exception 'Invalid review decision or rejection reason' using errcode='22023';end if;
 select i.id,i.author_id,i.content_type into target,owner,kind from public.content_revisions r join public.content_items i on i.id=r.item_id where r.id=p_revision_id;
 if target is null then raise exception 'Only a pending revision may be reviewed' using errcode='22023';end if;
 perform public.community_cycle_lock(owner,kind);
 select * into item from public.content_items where id=target for update;
 select * into rev from public.content_revisions where id=p_revision_id for update;
 if rev.status<>'pending' then raise exception 'Only a pending revision may be reviewed' using errcode='22023';end if;
 fresh:=not exists(select 1 from public.content_first_publications where item_id=item.id);
 select * into strict cycle from public.content_review_cycles where user_id=owner and content_type=kind;
 if p_decision='approved' and fresh and cycle.gate_item_id is not null and cycle.gate_item_id<>item.id then raise exception 'Resolve the earlier review gate first' using errcode='22023';end if;
 result:=case when p_decision='approved' then 'approved' else 'rejected' end;
 update public.content_reviews set status=result,review_outcome=case when p_decision='rejected' then 'returned' else p_decision end,reviewer_id=auth.uid(),rejection_reason=p_rejection_reason,resolved_at=now() where revision_id=p_revision_id;
 update public.content_revisions set status=result,rejection_reason=p_rejection_reason,resolved_at=now() where id=p_revision_id;
 if p_decision='approved' then
  perform public.community_record_first_publication(item.id,p_revision_id);
  update public.content_items set published_revision_id=p_revision_id where id=item.id;
 elsif p_decision='trashed' then
  insert into public.content_revision_trash(revision_id,item_id,actor_id,reason) values(p_revision_id,item.id,auth.uid(),p_rejection_reason);
  -- Release this item, retain the mandatory review debt. A new item cannot bypass it.
  update public.content_review_cycles set gate_item_id=null where user_id=owner and content_type=kind and gate_item_id=item.id;
 end if;
 insert into public.community_management_audit(actor_id,action,item_id,revision_id,details) values(auth.uid(),'review_'||p_decision,item.id,p_revision_id,jsonb_build_object('reason',p_rejection_reason));
end; $$;
create function public.community_restore_revision(p_revision_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i public.content_items;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 select i0.* into strict i from public.content_items i0 join public.content_revision_trash t on t.item_id=i0.id where t.revision_id=p_revision_id;
 perform public.community_cycle_lock(i.author_id,i.content_type);
 perform 1 from public.content_items where id=i.id for update;
 update public.content_revision_trash set restored_at=now(),restored_by=auth.uid() where revision_id=p_revision_id and restored_at is null;
 if not found then raise exception 'Trash already restored' using errcode='22023';end if;
 -- Restoration never publishes or alters immutable revisions; the author creates a new draft.
 if not exists(select 1 from public.content_first_publications where item_id=i.id) then update public.content_review_cycles set review_due=true where user_id=i.author_id and content_type=i.content_type;end if;
 insert into public.community_management_audit(actor_id,action,item_id,revision_id) values(auth.uid(),'restore_trash',i.id,p_revision_id);
end; $$;
create function public.community_set_featured(p_item_id uuid,p_featured boolean) returns void
language plpgsql security definer set search_path='' as $$
declare i public.content_items;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_featured is null then raise exception 'Invalid featured state' using errcode='22023';end if;
 select * into i from public.content_items where id=p_item_id for update;
 if i.id is null or i.content_type<>'article' or i.published_revision_id is null then raise exception 'Published article required' using errcode='22023';end if;
 if i.featured=p_featured then return;end if;
 update public.content_items set featured=p_featured where id=i.id;
 update public.community_publication_state set status='pending',last_error=null where item_id=i.id;
 insert into public.community_management_audit(actor_id,action,item_id,details) values(auth.uid(),'set_featured',i.id,jsonb_build_object('featured',p_featured));
 if p_featured and i.author_id<>auth.uid() then insert into public.notifications(user_id,actor_id,type,title,body,revision_id,target_type,target_id)
 values(i.author_id,auth.uid(),'content_featured','文章已入选精选','你的文章被站长选为精选。',i.published_revision_id,'content',i.id::text);end if;
end; $$;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('comment_approved','comment_rejected','comment_reply','comment_like','follow','content_approved','content_rejected','content_returned','content_trashed','content_featured','comment_edit_approved','comment_edit_rejected','content_like','content_comment','direct_message'));
create or replace function public.community_notify_review_result() returns trigger language plpgsql security definer set search_path='' as $$
declare author uuid; kind text;
begin
 if old.status='pending' and new.status in ('approved','rejected') and new.decision_source='admin' then
  select author_id into author from public.content_items where id=new.item_id;
  kind:=case when new.review_outcome='trashed' then 'content_trashed' when new.review_outcome='returned' then 'content_returned' else 'content_'||new.status end;
  if author is not null and author<>new.reviewer_id then insert into public.notifications(user_id,actor_id,type,title,body,revision_id)
   values(author,new.reviewer_id,kind,case kind when 'content_approved' then '内容审核通过' when 'content_trashed' then '内容已移入回收站' else '内容退回修改' end,coalesce(new.rejection_reason,''),new.revision_id);end if;
 end if;return new;
end; $$;
-- Explicit ACLs for every new definer, including internal helpers.
revoke all on function public.community_cycle_lock(uuid,text),public.community_record_first_publication(uuid,uuid),public.community_set_review_cycle(uuid,text,integer),public.community_review_cycle_status(uuid),public.community_restore_revision(uuid),public.community_set_featured(uuid,boolean) from public,anon,authenticated;
grant execute on function public.community_set_review_cycle(uuid,text,integer),public.community_review_cycle_status(uuid),public.community_restore_revision(uuid),public.community_set_featured(uuid,boolean) to authenticated;
commit;
