begin;
create table public.community_site_settings (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id) on delete set null,
 settings jsonb not null, created_at timestamptz not null default now(),
 published_at timestamptz, commit_sha text check(commit_sha ~ '^[0-9a-f]{40}$')
);
alter table public.community_site_settings enable row level security;
revoke all on public.community_site_settings from public,anon,authenticated;
grant select on public.community_site_settings to authenticated;
create policy site_settings_admin_read on public.community_site_settings for select to authenticated using(public.is_admin());
create function public.community_save_site_settings(p_settings jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare k text; v text; result uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if jsonb_typeof(p_settings) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_settings) key where key not in ('siteName','introTitle','introText','aboutTitle','aboutText','contactEmail','aboutDocument')) then raise exception 'Invalid site settings' using errcode='22023';end if;
 foreach k in array array['siteName','introTitle','introText','aboutTitle','aboutText','contactEmail'] loop
  v:=p_settings->>k;
  if jsonb_typeof(p_settings->k) is distinct from 'string' or char_length(v)>2000 or v ~ '[<>]' or (k='siteName' and char_length(btrim(v)) not between 1 and 80) or (k='contactEmail' and v !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') then raise exception 'Invalid site text' using errcode='22023';end if;
 end loop;
 -- The same safe document validator, no asset or HTML/site-script bypass.
 perform public.community_validate_document(p_settings->'aboutDocument','{}',100000,
 (select coalesce(string_agg(case when b->>'type'='list' then (select string_agg(public.community_validate_inline(r),E'\n' order by ord) from jsonb_array_elements(b->'items') with ordinality x(r,ord)) else public.community_validate_inline(b->'runs') end,E'\n\n' order by n),'') from jsonb_array_elements(p_settings->'aboutDocument'->'blocks') with ordinality b(b,n)));
 insert into public.community_site_settings(actor_id,settings) values(auth.uid(),p_settings) returning id into result;
 insert into public.community_management_audit(actor_id,action,details) values(auth.uid(),'save_site_settings',jsonb_build_object('settings_id',result));
 return result;
end; $$;
create function public.community_site_settings_export() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'settings',settings) from public.community_site_settings order by created_at desc,id desc limit 1;
$$;
create function public.community_site_settings_result(p_id uuid,p_commit_sha text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$' then raise exception 'Invalid commit SHA';end if;
 update public.community_site_settings set published_at=coalesce(published_at,now()),commit_sha=p_commit_sha where id=p_id;
end; $$;
revoke all on function public.community_save_site_settings(jsonb),public.community_site_settings_export(),public.community_site_settings_result(uuid,text) from public,anon,authenticated;
grant execute on function public.community_save_site_settings(jsonb) to authenticated;
grant execute on function public.community_site_settings_export(),public.community_site_settings_result(uuid,text) to service_role;
commit;
