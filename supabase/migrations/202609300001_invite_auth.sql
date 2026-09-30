-- Run after disabling public sign-ups in Supabase Auth. Never expose service_role in the browser.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'moderator', 'admin')) default 'user',
  created_at timestamptz not null default now()
);

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create function public.on_auth_user_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, username, display_name)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 24), left(coalesce(new.raw_user_meta_data->>'display_name', ''), 80));
  insert into public.user_roles(user_id, role) values (new.id, 'user');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.on_auth_user_created();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- No client INSERT/DELETE. The auth trigger creates rows; only the SQL editor may assign roles.
create policy roles_read_own_or_admin on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
revoke insert, delete, update on public.profiles from anon, authenticated;
grant update(username, display_name, avatar_url, bio) on public.profiles to authenticated;
revoke insert, delete, update on public.user_roles from anon, authenticated;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_slug text not null check (char_length(post_slug) between 1 and 160),
  user_id uuid references auth.users(id) on delete set null,
  parent_id uuid references public.comments(id) on delete set null,
  legacy_author_name text,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comment_author check (user_id is null or legacy_author_name is null)
);
create index comments_slug_status_created on public.comments(post_slug, status, created_at);
create index comments_author on public.comments(user_id, created_at desc);
create trigger comments_touch before update on public.comments for each row execute function public.touch_updated_at();

-- Enforce reply target even when a client skips the UI. Legacy replies are imported with parent_id null.
create function public.validate_comment_reply() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.comments p where p.id = new.parent_id and p.post_slug = new.post_slug
      and (p.status = 'approved' or p.user_id = (select auth.uid()) or public.is_admin())
  ) then raise exception 'Invalid reply target'; end if;
  return new;
end;
$$;
create trigger comments_validate_reply before insert or update on public.comments
  for each row execute function public.validate_comment_reply();

alter table public.comments enable row level security;
create policy comments_read_visible on public.comments for select to anon, authenticated
  using (status = 'approved' or user_id = (select auth.uid()) or public.is_admin());
create policy comments_insert_self on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and legacy_author_name is null and status = 'pending');
create policy comments_admin_update on public.comments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy comments_admin_delete on public.comments for delete to authenticated using (public.is_admin());
revoke update on public.comments from anon, authenticated;
grant update(status) on public.comments to authenticated;

create table public.likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'moment')),
  target_id text not null check (char_length(target_id) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index likes_target on public.likes(target_type, target_id);
alter table public.likes enable row level security;
create policy likes_read on public.likes for select to anon, authenticated using (true);
create policy likes_insert_self on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and (target_type <> 'comment' or exists (
    select 1 from public.comments c where c.id::text = target_id and c.status = 'approved')));
create policy likes_delete_self on public.likes for delete to authenticated using (user_id = (select auth.uid()));

create table public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, target_id),
  check (follower_id <> target_id)
);
create index follows_target on public.follows(target_id);
alter table public.follows enable row level security;
create policy follows_read on public.follows for select to anon, authenticated using (true);
create policy follows_insert_self on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
create policy follows_delete_self on public.follows for delete to authenticated using (follower_id = (select auth.uid()));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];
create policy avatars_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy avatars_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
