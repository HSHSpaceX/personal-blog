-- Round 2: immutable text schemas and per-user NEW-content trust. History stays intact.
begin;
create table public.user_review_thresholds (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('article','moment','album')),
  manual_approvals_required integer check (manual_approvals_required between 0 and 10000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(), primary key(user_id,content_type)
);
-- One credit per first manually approved item, never edits or automatic decisions.
create table public.content_approval_credits (
  item_id uuid primary key references public.content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('article','moment','album')),
  created_at timestamptz not null default now()
);
create index content_approval_credits_user_type on public.content_approval_credits(user_id,content_type);
-- Credit existing first manual approvals only when their reviewer identity is known.
insert into public.content_approval_credits(item_id,user_id,content_type)
select i.id,i.author_id,i.content_type from public.content_items i
where exists (select 1 from public.content_reviews r where r.item_id=i.id and r.status='approved'
  and r.decision_source='admin' and r.reviewer_id<>i.author_id
  and not exists (select 1 from public.content_reviews earlier where earlier.item_id=i.id
    and earlier.status='approved' and earlier.resolved_at<r.resolved_at));
alter table public.user_review_thresholds enable row level security;
alter table public.content_approval_credits enable row level security;
create policy thresholds_admin_read on public.user_review_thresholds for select to authenticated using(public.is_admin());
create policy credits_admin_read on public.content_approval_credits for select to authenticated using(public.is_admin());
revoke all on public.user_review_thresholds,public.content_approval_credits from public,anon,authenticated;
grant select on public.user_review_thresholds,public.content_approval_credits to authenticated;
alter table public.content_reviews drop constraint content_reviews_decision_source_check;
alter table public.content_reviews add constraint content_reviews_decision_source_check
  check(decision_source in ('admin','policy','admin_auto'));

-- No HTML or URL fields. Strings are plain text, rendered with textContent only.
create function public.community_validate_body(p_type text,p_body jsonb) returns uuid[]
language plpgsql immutable set search_path='' as $$
declare allowed text[]; v jsonb; entry jsonb; ids uuid[] := '{}'; asset uuid;
begin
  if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>1048576 then
    raise exception 'Invalid content schema' using errcode='22023'; end if;
  allowed := case p_type when 'article' then array['text','summary','tags','asset_ids']
    when 'moment' then array['text','asset_ids'] when 'album' then array['description','photos'] end;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_body) k where not(k=any(allowed))) then
    raise exception 'Invalid content fields' using errcode='22023'; end if;
  if p_type in ('article','moment') then
    if jsonb_typeof(p_body->'text') is distinct from 'string' or
      char_length(btrim(p_body->>'text'))<1 or
      char_length(p_body->>'text')>(case when p_type='article' then 100000 else 2000 end) then
      raise exception 'Invalid content text' using errcode='22023'; end if;
  end if;
  foreach v in array array[p_body->'summary',p_body->'description'] loop
    if v is not null and (jsonb_typeof(v)<>'string' or char_length(v#>>'{}')>
      (case when p_type='album' then 2000 else 500 end)) then
      raise exception 'Invalid content description' using errcode='22023'; end if;
  end loop;
  if p_body ? 'tags' then
    if jsonb_typeof(p_body->'tags')<>'array' or jsonb_array_length(p_body->'tags')>10 then
      raise exception 'Invalid tags' using errcode='22023'; end if;
    for v in select value from jsonb_array_elements(p_body->'tags') loop
      if jsonb_typeof(v)<>'string' or char_length(btrim(v#>>'{}'))<1 or char_length(v#>>'{}')>30 then
        raise exception 'Invalid tag' using errcode='22023'; end if;
    end loop;
  end if;
  if p_type='album' then
    if jsonb_typeof(p_body->'photos') is distinct from 'array' or jsonb_array_length(p_body->'photos') not between 1 and 100 then
      raise exception 'An album needs 1 to 100 photos' using errcode='22023'; end if;
    for entry in select value from jsonb_array_elements(p_body->'photos') loop
      if jsonb_typeof(entry)<>'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('asset_id','caption'))
        or jsonb_typeof(entry->'asset_id') is distinct from 'string' or
        ((entry ? 'caption') and (jsonb_typeof(entry->'caption')<>'string' or char_length(entry->>'caption')>200)) then
        raise exception 'Invalid album photo' using errcode='22023'; end if;
      if (entry->>'asset_id') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
        raise exception 'Invalid asset UUID' using errcode='22023'; end if;
      ids:=array_append(ids,(entry->>'asset_id')::uuid);
    end loop;
  elsif p_body ? 'asset_ids' then
    if jsonb_typeof(p_body->'asset_ids')<>'array' or jsonb_array_length(p_body->'asset_ids')>
      (case when p_type='moment' then 9 else 20 end) then
      raise exception 'Invalid asset list' using errcode='22023'; end if;
    for v in select value from jsonb_array_elements(p_body->'asset_ids') loop
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
        raise exception 'Invalid asset UUID' using errcode='22023'; end if;
      ids:=array_append(ids,(v#>>'{}')::uuid);
    end loop;
  end if;
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then
    raise exception 'Duplicate asset reference' using errcode='22023'; end if;
  return ids;
end;
$$;
revoke all on function public.community_validate_body(text,jsonb) from public,anon,authenticated;

create function public.community_set_user_review_threshold(p_user_id uuid,p_content_type text,p_threshold integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  insert into public.user_review_thresholds(user_id,content_type,manual_approvals_required,updated_by)
    values(p_user_id,p_content_type,p_threshold,auth.uid()) on conflict(user_id,content_type) do update
    set manual_approvals_required=excluded.manual_approvals_required,updated_by=auth.uid(),updated_at=now();
end;
$$;
create function public.community_review_policy_status(p_user_id uuid)
returns table(content_type text,manual_approvals_required integer,approved_new_count bigint)
language sql stable security definer set search_path='' as $$
  select t.kind,r.manual_approvals_required,(select count(*) from public.content_approval_credits c
    where c.user_id=p_user_id and c.content_type=t.kind)
  from (values('article'),('moment'),('album')) t(kind)
  left join public.user_review_thresholds r on r.user_id=p_user_id and r.content_type=t.kind
  where auth.uid() is not null and public.is_admin();
$$;
-- Disable the obsolete global bypass, including direct calls to the old RPC.
create or replace function public.community_set_review_policy(p_content_type text,p_requires_review boolean)
returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'Use per-user review thresholds' using errcode='22023'; end;
$$;
revoke all on function public.community_set_review_policy(text,boolean) from public,anon,authenticated;

create or replace function public.community_submit_revision(p_revision_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare item public.content_items; rev public.content_revisions; target uuid; threshold integer; credits bigint;
  auto_publish boolean; source text; snapshot jsonb;
begin
  select item_id into target from public.content_revisions where id=p_revision_id;
  select * into item from public.content_items where id=target for update;
  if auth.uid() is null or item.author_id is distinct from auth.uid() then
    raise exception 'Content unavailable' using errcode='42501'; end if;
  select * into rev from public.content_revisions where id=p_revision_id for update;
  if rev.status<>'draft' or exists(select 1 from public.content_revisions
    where id=item.published_revision_id and revision_no>=rev.revision_no) then
    raise exception 'Only a newer draft may be submitted' using errcode='22023'; end if;
  if exists(select 1 from public.content_revisions where item_id=item.id and status='pending') then
    raise exception 'An item already has a pending revision' using errcode='22023'; end if;
  perform public.community_validate_body(item.content_type,rev.body);
  -- Serialize rule updates for this user/type while evaluating the snapshot.
  select manual_approvals_required into threshold from public.user_review_thresholds
    where user_id=item.author_id and content_type=item.content_type for share;
  select count(*) into credits from public.content_approval_credits
    where user_id=item.author_id and content_type=item.content_type;
  auto_publish := public.is_admin() or (item.published_revision_id is null and threshold is not null and credits>=threshold);
  source:=case when public.is_admin() then 'admin_auto' when auto_publish then 'policy' else 'admin' end;
  snapshot:=jsonb_build_object('content_type',item.content_type,'is_new_item',item.published_revision_id is null,
    'manual_approvals_required',threshold,'approved_new_count',credits,'requires_review',not auto_publish);
  update public.content_revisions set status=case when auto_publish then 'approved' else 'pending' end,
    submitted_at=now(),resolved_at=case when auto_publish then now() else null end where id=p_revision_id;
  insert into public.content_reviews(item_id,revision_id,status,decision_source,policy_snapshot,reviewer_id,resolved_at)
    values(item.id,p_revision_id,case when auto_publish then 'approved' else 'pending' end,source,snapshot,
      case when source='admin_auto' then auth.uid() else null end,case when auto_publish then now() else null end);
  if auto_publish then update public.content_items set published_revision_id=p_revision_id where id=item.id; end if;
end;
$$;
create or replace function public.community_review_revision(p_revision_id uuid,p_decision text,p_rejection_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare item public.content_items; rev public.content_revisions; target uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or
    (p_decision='rejected' and (p_rejection_reason is null or char_length(btrim(p_rejection_reason)) not between 1 and 2000)) or
    (p_decision='approved' and p_rejection_reason is not null) then
    raise exception 'Invalid review decision or rejection reason' using errcode='22023'; end if;
  select item_id into target from public.content_revisions where id=p_revision_id;
  select * into item from public.content_items where id=target for update;
  select * into rev from public.content_revisions where id=p_revision_id for update;
  if rev.id is null or rev.status<>'pending' then raise exception 'Only a pending revision may be reviewed' using errcode='22023'; end if;
  update public.content_reviews set status=p_decision,reviewer_id=auth.uid(),rejection_reason=p_rejection_reason,
    resolved_at=now() where revision_id=p_revision_id;
  update public.content_revisions set status=p_decision,rejection_reason=p_rejection_reason,resolved_at=now() where id=p_revision_id;
  if p_decision='approved' then
    if item.published_revision_id is null and item.author_id<>auth.uid() then
      insert into public.content_approval_credits(item_id,user_id,content_type) values(item.id,item.author_id,item.content_type)
        on conflict(item_id) do nothing;
    end if;
    update public.content_items set published_revision_id=p_revision_id where id=item.id;
  end if;
end;
$$;
revoke all on function public.community_set_user_review_threshold(uuid,text,integer),
  public.community_review_policy_status(uuid) from public,anon,authenticated;
grant execute on function public.community_set_user_review_threshold(uuid,text,integer),
  public.community_review_policy_status(uuid) to authenticated;
commit;
