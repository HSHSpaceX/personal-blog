begin;
-- Published date is the first approval, never the latest edited revision.
create or replace function public.community_publication_export() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(v || jsonb_build_object('featured',i.featured,'published_at',coalesce(m.published_at,f.approved_at,(v->>'published_at')::timestamptz)) || case when m.item_id is not null then jsonb_build_object('legacy',jsonb_build_object('target_type',m.target_type,'target_id',m.target_id,'source_sha256',m.source_sha256,'published_at',m.published_at)) else '{}'::jsonb end order by i.id),'[]'::jsonb)
 from jsonb_array_elements(public.community_publication_export_base()) v join public.content_items i on i.id=(v->>'id')::uuid
 left join public.community_legacy_mappings m on m.item_id=i.id left join public.content_first_publications f on f.item_id=i.id;
$$;
create table public.community_comment_trash (
 kind text not null check(kind in ('comment','comment_edit')), target_id uuid not null, author_id uuid references auth.users(id) on delete set null,
 reason text not null, actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), restored_at timestamptz,
 primary key(kind,target_id)
);
alter table public.community_comment_trash enable row level security;
revoke all on public.community_comment_trash from public,anon,authenticated;
grant select on public.community_comment_trash to authenticated;
create policy comment_trash_private on public.community_comment_trash for select to authenticated using(author_id=auth.uid() or public.is_admin());
create function public.community_review_queue(p_type text default 'all',p_status text default 'pending',p_search text default '',p_newest boolean default false,p_limit integer default 20,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 if p_type not in ('all','article','moment','album','comment') or p_status not in ('all','pending','approved','returned','trashed') or char_length(p_search)>120 then raise exception 'Invalid review filter' using errcode='22023';end if;
 return query with entries as (
 select r.id,'content'::text kind,i.content_type type,i.author_id,r.title,r.submitted_at as submitted,
 case when v.review_outcome='trashed' and tr.restored_at is not null then 'returned' else coalesce(v.review_outcome,r.status) end status,r.body,coalesce(old.body,'{}'::jsonb) previous_body,old.title previous_title,
 i.published_revision_id is not null as is_edit,coalesce((v.policy_snapshot->>'review_due')::boolean,false) as review_due
 from public.content_reviews v join public.content_revisions r on r.id=v.revision_id join public.content_items i on i.id=r.item_id left join public.content_revisions old on old.id=i.published_revision_id and old.id<>r.id left join public.content_revision_trash tr on tr.revision_id=r.id
 union all
 select c.id,'comment','comment',c.user_id,'评论',c.created_at,case when t.target_id is not null and t.restored_at is null then 'trashed' when c.status='rejected' then 'returned' else c.status end,jsonb_build_object('text',c.content),'{}',null,false,false from public.comments c left join public.community_comment_trash t on t.kind='comment' and t.target_id=c.id
 union all
 select c.id,'comment_edit','comment',c.author_id,'评论修改',c.created_at,case when t.target_id is not null and t.restored_at is null then 'trashed' when c.status='rejected' then 'returned' else c.status end,jsonb_build_object('text',c.proposed_content),jsonb_build_object('text',c.previous_content),null,true,false from public.comment_edits c left join public.community_comment_trash t on t.kind='comment_edit' and t.target_id=c.id
 ) select to_jsonb(e)||jsonb_build_object('author',jsonb_build_object('username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url))
 from entries e left join public.profiles p on p.id=e.author_id
 where (p_type='all' or e.type=p_type) and (p_status='all' or e.status=p_status)
 and (p_search='' or strpos(lower(coalesce(p.username,'')||' '||coalesce(p.display_name,'')||' '||coalesce(e.author_id::text,'')),lower(p_search))>0)
 order by case when p_newest then e.submitted end desc,case when not p_newest then e.submitted end asc,e.id limit p_limit offset p_offset;
end $$;
create function public.community_review_entry(p_kind text,p_id uuid,p_decision text,p_reason text default null,p_expected text default null) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid; state text; content text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_decision not in ('approved','returned','trashed') or (p_decision<>'approved' and (p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000)) then raise exception 'Decision and reason required' using errcode='22023';end if;
 if p_kind='content' then perform public.community_review_revision(p_id,p_decision,p_reason);return;end if;
 if p_kind='comment' then
  select user_id,status,c.content into owner,state,content from public.comments c where id=p_id for update;
  if state is distinct from 'pending' or content is distinct from p_expected then raise exception 'Comment changed or already reviewed' using errcode='22023';end if;
  perform public.community_moderate_comment(p_id,case when p_decision='approved' then 'approved' else 'rejected' end,p_reason,p_expected);
 elsif p_kind='comment_edit' then
  -- Keep comment-first lock order used by the existing review RPC.
  perform 1 from public.comments where id=(select comment_id from public.comment_edits where id=p_id) for update;
  select author_id,status into owner,state from public.comment_edits where id=p_id for update;
  if state is distinct from 'pending' then raise exception 'Comment changed or already reviewed' using errcode='22023';end if;
  perform public.community_review_comment_edit(p_id,case when p_decision='approved' then 'approved' else 'rejected' end,p_reason);
 else raise exception 'Invalid review kind';end if;
 if p_decision='trashed' then insert into public.community_comment_trash(kind,target_id,author_id,reason,actor_id) values(p_kind,p_id,owner,p_reason,auth.uid()) on conflict(kind,target_id) do update set reason=excluded.reason,actor_id=excluded.actor_id,created_at=now(),restored_at=null;end if;
end $$;
create function public.community_restore_comment(p_kind text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 update public.community_comment_trash set restored_at=now() where kind=p_kind and target_id=p_id and restored_at is null;
end $$;
revoke all on function public.community_review_queue(text,text,text,boolean,integer,integer),public.community_review_entry(text,uuid,text,text,text),public.community_restore_comment(text,uuid) from public,anon,authenticated;
grant execute on function public.community_review_queue(text,text,text,boolean,integer,integer),public.community_review_entry(text,uuid,text,text,text),public.community_restore_comment(text,uuid) to authenticated;
create function public.community_guard_comment_trash() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if tg_table_name='comments' then cid:=new.id;else cid:=new.comment_id;end if;
 if exists(select 1 from public.community_comment_trash t where t.restored_at is null and
 ((t.kind='comment' and t.target_id=cid) or (t.kind='comment_edit' and t.target_id in (select e.id from public.comment_edits e where e.comment_id=cid)))) then
  raise exception 'Comment is in trash; administrator restoration is required before editing' using errcode='42501';
 end if;
 return new;
end $$;
create trigger comment_trash_guard before update of content,status on public.comments for each row
 when (new.content is distinct from old.content or new.status is distinct from old.status) execute function public.community_guard_comment_trash();
create trigger comment_edit_trash_guard before insert on public.comment_edits for each row execute function public.community_guard_comment_trash();
revoke all on function public.community_guard_comment_trash() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
