-- User-facing notifications for comment approval, replies, likes and follows.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('comment_approved', 'comment_reply', 'comment_like', 'follow')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 500),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_recipient on public.notifications(user_id, read, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on table public.notifications from public, anon, authenticated;
grant select, update (read) on public.notifications to authenticated;

create function public.notify_comment_approved() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.user_id is not null then
    insert into public.notifications(user_id, type, title, body)
    values (new.user_id, 'comment_approved', '评论审核通过', left(new.content, 200));
  end if;
  return new;
end;
$$;
create trigger notifications_comment_approved after update of status on public.comments
  for each row execute function public.notify_comment_approved();

create function public.notify_comment_reply() returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  parent_owner uuid;
begin
  if new.parent_id is not null and new.user_id is not null then
    select user_id into parent_owner from public.comments where id = new.parent_id;
    if parent_owner is not null and parent_owner <> new.user_id then
      insert into public.notifications(user_id, actor_id, type, title, body)
      values (parent_owner, new.user_id, 'comment_reply', '收到评论回复', left(new.content, 200));
    end if;
  end if;
  return new;
end;
$$;
create trigger notifications_comment_reply after insert on public.comments
  for each row execute function public.notify_comment_reply();

create function public.notify_comment_like() returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  comment_owner uuid;
begin
  if new.target_type = 'comment' and new.user_id is not null then
    select user_id into comment_owner from public.comments where id::text = new.target_id;
    if comment_owner is not null and comment_owner <> new.user_id then
      insert into public.notifications(user_id, actor_id, type, title, body)
      values (comment_owner, new.user_id, 'comment_like', '评论被点赞', '');
    end if;
  end if;
  return new;
end;
$$;
create trigger notifications_comment_like after insert on public.likes
  for each row execute function public.notify_comment_like();

create function public.notify_follow() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.follower_id is distinct from new.target_id then
    insert into public.notifications(user_id, actor_id, type, title, body)
    values (new.target_id, new.follower_id, 'follow', '收到新关注', '');
  end if;
  return new;
end;
$$;
create trigger notifications_follow after insert on public.follows
  for each row execute function public.notify_follow();

-- Keep notification helpers from being exposed as RPCs.
revoke all on function public.notify_comment_approved(), public.notify_comment_reply(),
  public.notify_comment_like(), public.notify_follow() from public, anon, authenticated;
