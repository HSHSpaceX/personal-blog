-- Explicit least-privilege grants: RLS does not protect TRUNCATE, and Supabase
-- projects may give newly created public tables broad default privileges.
begin;
revoke all on table public.profiles, public.user_roles, public.comments,
  public.likes, public.follows from public, anon, authenticated;
-- Also remove existing column grants before rebuilding the allowlist.
revoke all (id, username, display_name, avatar_url, bio, created_at, updated_at)
  on public.profiles from public, anon, authenticated;
revoke all (user_id, role, created_at) on public.user_roles from public, anon, authenticated;
revoke all (id, post_slug, user_id, parent_id, legacy_author_name, content, status, created_at, updated_at)
  on public.comments from public, anon, authenticated;
revoke all (user_id, target_type, target_id, created_at) on public.likes from public, anon, authenticated;
revoke all (follower_id, target_id, created_at) on public.follows from public, anon, authenticated;

grant select on public.profiles, public.comments to anon, authenticated;
grant select on public.user_roles, public.likes, public.follows to authenticated;
grant update (username, display_name, avatar_url, bio) on public.profiles to authenticated;
grant insert (post_slug, user_id, parent_id, content, status) on public.comments to authenticated;
grant update (status), delete on public.comments to authenticated;
grant insert (user_id, target_type, target_id), delete on public.likes to authenticated;
grant insert (follower_id, target_id), delete on public.follows to authenticated;

-- Validate a new/changed reply target, not unrelated status/user_id updates.
-- Otherwise auth.users deletion (ON DELETE SET NULL) can fail for pending replies.
drop trigger comments_validate_reply on public.comments;
create trigger comments_validate_reply before insert or update of parent_id, post_slug
  on public.comments for each row execute function public.validate_comment_reply();

-- Trigger functions are not public RPCs. Existing triggers continue to run.
revoke all on function public.on_auth_user_created(), public.touch_updated_at(),
  public.validate_comment_reply() from public, anon, authenticated;
revoke all on function public.is_admin(), public.like_counts(text, text[]),
  public.follower_count(uuid), public.user_like_count(uuid) from public, anon, authenticated;
grant execute on function public.is_admin(), public.like_counts(text, text[]),
  public.follower_count(uuid), public.user_like_count(uuid) to anon, authenticated;

create or replace function public.like_counts(p_target_type text, p_target_ids text[])
returns table(target_id text, like_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target_type is null or p_target_type not in ('post', 'comment', 'moment') or
     p_target_ids is null or cardinality(p_target_ids) > 100 or
     coalesce(array_ndims(p_target_ids), 1) <> 1 or exists (
       select 1 from unnest(p_target_ids) as item(id)
       where item.id is null or char_length(item.id) not between 1 and 160
     ) then
    raise exception 'Invalid like count request' using errcode = '22023';
  end if;
  return query select l.target_id, count(*)::bigint from public.likes l
    where l.target_type = p_target_type and l.target_id = any(p_target_ids)
    group by l.target_id;
end;
$$;
commit;
