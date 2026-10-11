-- Community V2 Round 1. Apply AFTER all existing migrations; never rewrite history.
-- Roles remain guest (no session), invited user, admin (a user with extra powers).
begin;

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('article', 'moment', 'album')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
  published_revision_id uuid,
  created_at timestamptz not null default now(),
  unique (content_type, slug)
);
create index content_items_author on public.content_items(author_id, created_at desc);

-- Snapshots are immutable. Editing means creating another draft, never changing
-- the body of the published revision. Only the current published snapshot is public.
create table public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 1048576),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  resolved_at timestamptz,
  unique (item_id, revision_no),
  unique (item_id, id),
  check ((status = 'rejected' and rejection_reason is not null and char_length(btrim(rejection_reason)) between 1 and 2000)
    or (status <> 'rejected' and rejection_reason is null)),
  check (status = 'draft' or submitted_at is not null),
  check ((status in ('approved', 'rejected')) = (resolved_at is not null))
);
create unique index content_one_pending_revision on public.content_revisions(item_id) where status = 'pending';
alter table public.content_items add constraint content_published_revision_same_item
  foreign key (id, published_revision_id) references public.content_revisions(item_id, id)
  deferrable initially deferred;

create table public.review_policies (
  content_type text primary key check (content_type in ('article', 'moment', 'album')),
  requires_review boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.review_policies(content_type) values ('article'), ('moment'), ('album');

-- This is the moderation queue/audit record, NOT the personal notification inbox.
-- Snapshot the rule on submission so later rule changes don't rewrite history.
create table public.content_reviews (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  revision_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id uuid references auth.users(id) on delete set null,
  decision_source text not null default 'admin' check (decision_source in ('admin', 'policy')),
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot) = 'object'),
  rejection_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (item_id, revision_id) references public.content_revisions(item_id, id) on delete cascade,
  check ((status = 'pending') = (resolved_at is null)),
  check ((status = 'rejected' and rejection_reason is not null and char_length(btrim(rejection_reason)) between 1 and 2000)
    or (status <> 'rejected' and rejection_reason is null))
);
create index content_reviews_queue on public.content_reviews(status, created_at);

-- Metadata foundation only: no upload UI, public URLs or Storage bucket creation.
-- Registry ownership is not proof a file exists; Storage policies come in Round 2.
create table public.user_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'community-assets' check (bucket_id = 'community-assets'),
  object_path text not null check (char_length(object_path) between 1 and 500),
  original_name text not null check (char_length(btrim(original_name)) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (size_bytes between 0 and 104857600),
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path),
  check (split_part(object_path, '/', 1) = owner_id::text
    and object_path like '%/_%' and object_path !~ '(^|/)\.\.?(/|$)')
);
create index user_assets_owner on public.user_assets(owner_id, created_at desc);

alter table public.content_items enable row level security;
alter table public.content_revisions enable row level security;
alter table public.content_reviews enable row level security;
alter table public.review_policies enable row level security;
alter table public.user_assets enable row level security;

create policy content_items_visible on public.content_items for select to anon, authenticated
  using (published_revision_id is not null or author_id = (select auth.uid()) or public.is_admin());
create policy content_revisions_visible on public.content_revisions for select to anon, authenticated
  using (exists (select 1 from public.content_items i where i.id = item_id and
    (i.published_revision_id = content_revisions.id or i.author_id = (select auth.uid()) or public.is_admin())));
create policy content_reviews_private on public.content_reviews for select to authenticated
  using (exists (select 1 from public.content_items i where i.id = item_id and
    (i.author_id = (select auth.uid()) or public.is_admin())));
create policy review_policies_admin_read on public.review_policies for select to authenticated using (public.is_admin());
create policy user_assets_private on public.user_assets for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());
create policy user_assets_insert_own on public.user_assets for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy user_assets_update_own on public.user_assets for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy user_assets_delete_own on public.user_assets for delete to authenticated using (owner_id = (select auth.uid()));

-- Defeat Supabase broad defaults (RLS cannot protect TRUNCATE/column grants).
revoke all on public.content_items, public.content_revisions, public.content_reviews,
  public.review_policies, public.user_assets from public, anon, authenticated;
grant select on public.content_items, public.content_revisions to anon, authenticated;
grant select on public.content_reviews, public.review_policies, public.user_assets to authenticated;
grant insert (owner_id, bucket_id, object_path, original_name, mime_type, size_bytes),
  update (original_name), delete on public.user_assets to authenticated;

-- No client DML on content/version/review/rule tables. All transitions are atomic
-- RPCs with a fixed search_path and explicit DB-role/author checks. No metadata roles.
create function public.community_create_item(p_content_type text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_id uuid;
begin
  if auth.uid() is null then raise exception 'Login required' using errcode = '42501'; end if;
  insert into public.content_items(author_id, content_type, slug)
    values (auth.uid(), p_content_type, p_slug) returning id into item_id;
  return item_id;
end;
$$;

create function public.community_save_revision(p_item_id uuid, p_title text, p_body jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item public.content_items; revision_id uuid; next_no integer;
begin
  select * into item from public.content_items where id = p_item_id for update;
  if auth.uid() is null or item.author_id is distinct from auth.uid() then
    raise exception 'Content unavailable' using errcode = '42501';
  end if;
  select coalesce(max(revision_no), 0) + 1 into next_no from public.content_revisions where item_id = p_item_id;
  insert into public.content_revisions(item_id, revision_no, title, body)
    values (p_item_id, next_no, p_title, p_body) returning id into revision_id;
  return revision_id;
end;
$$;

create function public.community_submit_revision(p_revision_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.content_items; revision public.content_revisions; policy public.review_policies; target_item uuid;
begin
  select item_id into target_item from public.content_revisions where id = p_revision_id;
  -- Lock the item first in EVERY transition; serialize concurrent authors/reviewers.
  select * into item from public.content_items where id = target_item for update;
  if auth.uid() is null or item.author_id is distinct from auth.uid() then
    raise exception 'Content unavailable' using errcode = '42501';
  end if;
  select * into revision from public.content_revisions where id = p_revision_id for update;
  if revision.status <> 'draft' or exists (select 1 from public.content_revisions
      where id = item.published_revision_id and revision_no >= revision.revision_no) then
    raise exception 'Only a newer draft may be submitted' using errcode = '22023';
  end if;
  if exists (select 1 from public.content_revisions where item_id = item.id and status = 'pending') then
    raise exception 'An item already has a pending revision' using errcode = '22023';
  end if;
  select * into strict policy from public.review_policies where content_type = item.content_type for share;
  update public.content_revisions set status = case when policy.requires_review then 'pending' else 'approved' end,
    submitted_at = now(), resolved_at = case when policy.requires_review then null else now() end
    where id = p_revision_id;
  insert into public.content_reviews(item_id, revision_id, status, decision_source, policy_snapshot, resolved_at)
    values (item.id, p_revision_id, case when policy.requires_review then 'pending' else 'approved' end,
      case when policy.requires_review then 'admin' else 'policy' end,
      jsonb_build_object('content_type', policy.content_type, 'requires_review', policy.requires_review,
        'updated_at', policy.updated_at), case when policy.requires_review then null else now() end);
  if not policy.requires_review then
    update public.content_items set published_revision_id = p_revision_id where id = item.id;
  end if;
end;
$$;

create function public.community_review_revision(p_revision_id uuid, p_decision text, p_rejection_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.content_items; revision public.content_revisions; target_item uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') or
    (p_decision = 'rejected' and (p_rejection_reason is null or char_length(btrim(p_rejection_reason)) not between 1 and 2000)) or
    (p_decision = 'approved' and p_rejection_reason is not null) then
    raise exception 'Invalid review decision or rejection reason' using errcode = '22023';
  end if;
  select item_id into target_item from public.content_revisions where id = p_revision_id;
  select * into item from public.content_items where id = target_item for update;
  select * into revision from public.content_revisions where id = p_revision_id for update;
  if revision.id is null or revision.status <> 'pending' then
    raise exception 'Only a pending revision may be reviewed' using errcode = '22023';
  end if;
  update public.content_reviews set status = p_decision, reviewer_id = auth.uid(),
    rejection_reason = p_rejection_reason, resolved_at = now() where revision_id = p_revision_id;
  update public.content_revisions set status = p_decision, rejection_reason = p_rejection_reason,
    resolved_at = now() where id = p_revision_id;
  if p_decision = 'approved' then
    update public.content_items set published_revision_id = p_revision_id where id = item.id;
  end if;
end;
$$;

create function public.community_set_review_policy(p_content_type text, p_requires_review boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode = '42501'; end if;
  if p_content_type is null or p_content_type not in ('article', 'moment', 'album') or p_requires_review is null then
    raise exception 'Invalid review policy' using errcode = '22023';
  end if;
  update public.review_policies set requires_review = p_requires_review, updated_by = auth.uid(), updated_at = now()
    where content_type = p_content_type;
end;
$$;
revoke all on function public.community_create_item(text, text), public.community_save_revision(uuid, text, jsonb),
  public.community_submit_revision(uuid), public.community_review_revision(uuid, text, text),
  public.community_set_review_policy(text, boolean) from public, anon, authenticated;
grant execute on function public.community_create_item(text, text), public.community_save_revision(uuid, text, jsonb),
  public.community_submit_revision(uuid), public.community_review_revision(uuid, text, text),
  public.community_set_review_policy(text, boolean) to authenticated;
commit;
