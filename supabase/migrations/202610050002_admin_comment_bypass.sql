-- Admin comments publish immediately and admin actions do not create notifications.
create or replace function public.is_admin_id(p_user_id uuid) returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.user_roles where user_id = p_user_id and role = 'admin');
$$;
revoke all on function public.is_admin_id(uuid) from public, anon, authenticated;

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and legacy_author_name is null
    and (status = 'pending' or (status = 'approved' and public.is_admin())));

create or replace function public.notify_comment_approved() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.user_id is not null
     and not public.is_admin() and not public.is_admin_id(new.user_id) then
    insert into public.notifications(user_id, type, title, body)
    values (new.user_id, 'comment_approved', '评论审核通过', left(new.content, 200));
  end if;
  return new;
end;
$$;

create or replace function public.notify_comment_reply() returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  parent_owner uuid;
begin
  if new.parent_id is not null and new.user_id is not null and not public.is_admin() then
    select user_id into parent_owner from public.comments where id = new.parent_id;
    if parent_owner is not null and parent_owner <> new.user_id
       and not public.is_admin_id(parent_owner) then
      insert into public.notifications(user_id, actor_id, type, title, body)
      values (parent_owner, new.user_id, 'comment_reply', '收到评论回复', left(new.content, 200));
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.notify_comment_like() returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  comment_owner uuid;
begin
  if new.target_type = 'comment' and new.user_id is not null and not public.is_admin() then
    select user_id into comment_owner from public.comments where id::text = new.target_id;
    if comment_owner is not null and comment_owner <> new.user_id
       and not public.is_admin_id(comment_owner) then
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
  if new.follower_id is distinct from new.target_id and not public.is_admin()
     and not public.is_admin_id(new.target_id) then
    insert into public.notifications(user_id, actor_id, type, title, body)
    values (new.target_id, new.follower_id, 'follow', '收到新关注', '');
  end if;
  return new;
end;
$$;
