-- Owner-initiated deletion (Round 14).
-- 1) Direct deletion of unpublished drafts (never public, no review needed).
-- 2) Deletion requests for published articles/albums, decided in the review center.
-- Purely additive: new table, indexes, RLS, four RPCs, one notification-type
-- extension. The release contract (community_capabilities /
-- community_release_preflight) is deliberately unchanged.
begin;

create table public.content_deletion_requests (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.content_items(id) on delete cascade,
 requester_id uuid not null references auth.users(id) on delete cascade,
 reason text not null default '' check(octet_length(reason)<=1000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewer_id uuid references auth.users(id) on delete set null,
 decision_reason text check(decision_reason is null or char_length(btrim(decision_reason)) between 1 and 2000),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 check((status='pending')=(resolved_at is null)),
 check((status='rejected')=(decision_reason is not null)),
 check((status in ('pending','approved'))=(decision_reason is null))
);
create unique index content_deletion_one_pending on public.content_deletion_requests(item_id) where status='pending';
create index content_deletion_requests_item on public.content_deletion_requests(item_id,created_at desc);
create index content_deletion_requests_queue on public.content_deletion_requests(status,created_at);
alter table public.content_deletion_requests enable row level security;
revoke all on public.content_deletion_requests from public,anon,authenticated;
grant select on public.content_deletion_requests to authenticated;
create policy content_deletion_requests_visible on public.content_deletion_requests for select to authenticated
 using(requester_id=(select auth.uid()) or public.is_admin());

-- Direct deletion of an unpublished draft. Soft delete keeps recovery possible;
-- the existing content_deleted_guard then blocks any new revision on the item.
create function public.community_delete_draft(p_item_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare item public.content_items; v_type text;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 select content_type into v_type from public.content_items where id=p_item_id;
 if v_type is null then raise exception 'Content unavailable' using errcode='42501';end if;
 perform public.community_cycle_lock(auth.uid(),v_type);
 select * into item from public.content_items where id=p_item_id for update;
 if item.author_id is distinct from auth.uid() then raise exception 'Content unavailable' using errcode='42501';end if;
 if item.deleted_at is not null then return;end if;
 if item.published_revision_id is not null then raise exception '已发布内容不能直接删除：文章/图册请提交「申请删除」，动态请使用删除动态' using errcode='22023';end if;
 if exists(select 1 from public.content_revisions where item_id=item.id and status='pending') then raise exception '存在待审核版本，请先处理后再删除' using errcode='22023';end if;
 update public.content_items set published_revision_id=null,deleted_at=now() where id=item.id;
 insert into public.community_management_audit(actor_id,action,item_id,details) values(auth.uid(),'delete_draft',item.id,jsonb_build_object('content_type',item.content_type,'slug',item.slug));
end;
$$;

-- A published article/album owner asks for removal; only the admin decision deletes.
create function public.community_request_deletion(p_item_id uuid,p_reason text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare item public.content_items; req_id uuid; v_type text;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if p_reason is null or octet_length(p_reason)>1000 then raise exception '删除原因不能超过 1000 字符' using errcode='22023';end if;
 select content_type into v_type from public.content_items where id=p_item_id;
 if v_type is null then raise exception 'Content unavailable' using errcode='42501';end if;
 perform public.community_cycle_lock(auth.uid(),v_type);
 select * into item from public.content_items where id=p_item_id for update;
 if item.author_id is distinct from auth.uid() then raise exception 'Content unavailable' using errcode='42501';end if;
 if item.content_type not in ('article','album') then raise exception '只有文章和图册支持删除申请' using errcode='22023';end if;
 if item.deleted_at is not null then raise exception '内容已删除' using errcode='22023';end if;
 if item.published_revision_id is null then raise exception '未发布的草稿可直接删除，无需申请' using errcode='22023';end if;
 if exists(select 1 from public.content_revisions where item_id=item.id and status='pending') then raise exception '存在待审核版本，请先处理后再申请删除' using errcode='22023';end if;
 insert into public.content_deletion_requests(item_id,requester_id,reason) values(item.id,auth.uid(),btrim(p_reason)) returning id into req_id;
 insert into public.community_management_audit(actor_id,action,item_id,details) values(auth.uid(),'request_deletion',item.id,jsonb_build_object('request',req_id,'content_type',item.content_type,'slug',item.slug));
 return req_id;
end;
$$;

create function public.community_review_deletion(p_request_id uuid,p_decision text,p_rejection_reason text) returns void language plpgsql security definer set search_path='' as $$
declare req public.content_deletion_requests; item public.content_items;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid deletion decision' using errcode='22023';end if;
 if (p_decision='rejected')<>(p_rejection_reason is not null and char_length(btrim(p_rejection_reason)) between 1 and 2000) then raise exception 'Invalid review decision or rejection reason' using errcode='22023';end if;
 select * into req from public.content_deletion_requests where id=p_request_id for update;
 if req.status<>'pending' then raise exception 'Only a pending deletion request may be reviewed' using errcode='22023';end if;
 select * into item from public.content_items where id=req.item_id for update;
 if item.id is null then raise exception 'Deletion target no longer exists' using errcode='22023';end if;
 if p_decision='approved' and item.deleted_at is null then
  -- Same tombstone flow as moment deletion: the next publication sync removes
  -- the public page and media; rows stay recoverable in the database.
  update public.content_items set published_revision_id=null,deleted_at=now() where id=item.id;
 end if;
 update public.content_deletion_requests set status=p_decision,reviewer_id=auth.uid(),
  decision_reason=case when p_decision='rejected' then btrim(p_rejection_reason) else null end,
  resolved_at=now() where id=req.id;
 insert into public.community_management_audit(actor_id,action,item_id,details)
  values(auth.uid(),case when p_decision='approved' then 'approve_deletion' else 'reject_deletion' end,item.id,
   jsonb_build_object('request',req.id,'content_type',item.content_type,'slug',item.slug,
    'previous_revision',item.published_revision_id,
    'reason',case when p_decision='rejected' then p_rejection_reason else null end));
 if item.author_id<>auth.uid() then insert into public.notifications(user_id,actor_id,type,title,body,target_type,target_id)
  values(item.author_id,auth.uid(),
   case when p_decision='approved' then 'content_deleted' else 'deletion_request_returned' end,
   case when p_decision='approved' then '删除申请已批准' else '删除申请被退回' end,
   case when p_decision='approved' then '你的内容已从公开站点移除。' else coalesce(btrim(p_rejection_reason),'') end,
   'content',item.id::text);
 end if;
end;
$$;

-- Admin queue: one row per request with author and the current public title.
create function public.community_deletion_requests(p_status text default 'pending',p_limit integer default 20,p_offset integer default 0) returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 if p_status not in ('all','pending','approved','rejected') then raise exception 'Invalid deletion filter' using errcode='22023';end if;
 return query select to_jsonb(r) from (
  select d.id,d.item_id,d.requester_id,d.reason,d.status,d.created_at,d.decision_reason,d.resolved_at,
   i.content_type,i.slug,i.draft_title,i.deleted_at is not null as item_deleted,
   rw.title as latest_public_title,
   (select jsonb_build_object('username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url) from public.profiles p where p.id=i.author_id) as author
  from public.content_deletion_requests d
  join public.content_items i on i.id=d.item_id
  left join public.content_revisions rw on rw.id=i.published_revision_id
  where p_status='all' or d.status=p_status
  order by d.created_at asc,d.id
  limit p_limit offset p_offset
 ) r;
end;
$$;

-- Notification types for deletion outcomes (existing triggers and RLS unchanged).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('comment_approved','comment_rejected','comment_reply','comment_like','follow','content_approved','content_rejected','content_returned','content_trashed','content_featured','comment_edit_approved','comment_edit_rejected','content_like','content_comment','direct_message','content_deleted','deletion_request_returned'));

revoke all on function public.community_delete_draft(uuid),public.community_request_deletion(uuid,text),public.community_review_deletion(uuid,text,text),public.community_deletion_requests(text,integer,integer) from public,anon,authenticated;
grant execute on function public.community_delete_draft(uuid),public.community_request_deletion(uuid,text) to authenticated;
grant execute on function public.community_review_deletion(uuid,text,text),public.community_deletion_requests(text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
