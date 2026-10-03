-- Keep historical migration compatible with an already-created project.
-- Raw reactions are readable only by their owner; public pages use count-only RPCs.
update public.user_roles set role = 'user' where role = 'moderator';
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in ('user', 'admin'));

drop policy if exists likes_read on public.likes;
create policy likes_read_own on public.likes for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists follows_read on public.follows;
create policy follows_read_own on public.follows for select to authenticated
  using (follower_id = (select auth.uid()));

create function public.like_counts(p_target_type text, p_target_ids text[])
returns table(target_id text, like_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target_type not in ('post', 'comment', 'moment') or
     coalesce(array_length(p_target_ids, 1), 0) > 100 then
    raise exception 'Invalid like count request';
  end if;
  return query
    select l.target_id, count(*)::bigint
    from public.likes l
    where l.target_type = p_target_type and l.target_id = any(p_target_ids)
    group by l.target_id;
end;
$$;
revoke all on function public.like_counts(text, text[]) from public;
grant execute on function public.like_counts(text, text[]) to anon, authenticated;

create function public.follower_count(p_target_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*)::bigint from public.follows where target_id = p_target_id;
$$;
revoke all on function public.follower_count(uuid) from public;
grant execute on function public.follower_count(uuid) to anon, authenticated;

create function public.user_like_count(p_user_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*)::bigint from public.likes where user_id = p_user_id;
$$;
revoke all on function public.user_like_count(uuid) from public;
grant execute on function public.user_like_count(uuid) to anon, authenticated;
