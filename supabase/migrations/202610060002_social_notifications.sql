-- Admin is a social user too. Do not exclude either sender or recipient by role.
-- Personal notifications contain social events/results, never moderation tasks.
begin;
create or replace function public.notify_comment_approved() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.user_id is not null
     and new.user_id is distinct from auth.uid() then
    insert into public.notifications(user_id, actor_id, type, title, body)
    values (new.user_id, auth.uid(), 'comment_approved', '评论审核通过', left(new.content, 200));
  end if;
  return new;
end;
$$;

create or replace function public.notify_comment_reply() returns trigger language plpgsql security definer
set search_path = '' as $$
declare parent_owner uuid;
begin
  -- A pending/rejected reply is private; notify on approval.
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved')
     and new.parent_id is not null and new.user_id is not null then
    select user_id into parent_owner from public.comments where id = new.parent_id;
    if parent_owner is not null and parent_owner <> new.user_id then
      insert into public.notifications(user_id, actor_id, type, title, body)
      values (parent_owner, new.user_id, 'comment_reply', '收到评论回复', left(new.content, 200));
    end if;
  end if;
  return new;
end;
$$;
drop trigger notifications_comment_reply on public.comments;
create trigger notifications_comment_reply after insert or update of status on public.comments
  for each row execute function public.notify_comment_reply();

create or replace function public.notify_comment_like() returns trigger language plpgsql security definer
set search_path = '' as $$
declare comment_owner uuid;
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

create or replace function public.notify_follow() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.follower_id is distinct from new.target_id then
    insert into public.notifications(user_id, actor_id, type, title, body)
    values (new.target_id, new.follower_id, 'follow', '收到新关注', '');
  end if;
  return new;
end;
$$;
revoke all on function public.notify_comment_approved(), public.notify_comment_reply(),
  public.notify_comment_like(), public.notify_follow() from public, anon, authenticated;
commit;
