begin;
create function public.community_article_categories() returns text[] language sql immutable set search_path='' as $$
 select array['火箭部件','飞控制作','软件设计','嵌入式','AI','3D打印','人文历史','艺术创作','杂谈']::text[];
$$;
create function public.community_guard_new_category() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select content_type from public.content_items where id=new.item_id)='article' and not (new.body ? 'category') then new.body:=new.body||jsonb_build_object('category','杂谈');end if;
 if (select content_type from public.content_items where id=new.item_id)='article' and
  (new.body->>'category' is null or not (new.body->>'category'=any(public.community_article_categories()))) then
  raise exception 'Choose one of the nine archive categories for a new revision; old revisions remain readable' using errcode='22023';
 end if;
 return new;
end $$;
create trigger content_new_category before insert on public.content_revisions for each row execute function public.community_guard_new_category();
revoke all on function public.community_guard_new_category() from public,anon,authenticated;

-- Atomic initial save; retrying the same slug and payload returns the same draft.
create function public.community_create_draft(p_content_type text,p_slug text,p_title text,p_body jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.content_items; r public.content_revisions; new_id uuid;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if p_content_type='article' and not (p_body ? 'category') then p_body:=p_body||jsonb_build_object('category','杂谈');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_content_type||':'||p_slug,0));
 select * into i from public.content_items where content_type=p_content_type and slug=p_slug;
 if found then
  if i.author_id<>auth.uid() then raise exception 'Slug unavailable' using errcode='42501';end if;
  select * into r from public.content_revisions where item_id=i.id order by revision_no limit 1;
  if r.title is distinct from p_title or r.body is distinct from p_body then raise exception 'Initial request differs; reopen the saved item before editing' using errcode='22023';end if;
  return r.id;
 end if;
 new_id:=public.community_create_item(p_content_type,p_slug);
 return public.community_save_revision(new_id,p_title,p_body);
end $$;
revoke all on function public.community_create_draft(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.community_create_draft(text,text,text,jsonb) to authenticated;

-- Older backend settings must not silently overwrite the operator's newer main copy.
alter table public.community_site_settings add column source_version integer;
create function public.community_stamp_settings() returns trigger language plpgsql set search_path='' as $$begin new.source_version:=20261013;return new;end$$;
create trigger site_settings_release before insert on public.community_site_settings for each row execute function public.community_stamp_settings();
revoke all on function public.community_stamp_settings() from public,anon,authenticated;
create or replace function public.community_site_settings_export() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'settings',settings) from public.community_site_settings where source_version=20261013 order by created_at desc,id desc limit 1;
$$;

-- Capability reads never modify data. Publishing/import fail before their first write.
create function public.community_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',0,'categories',public.community_article_categories());
$$;
revoke all on function public.community_capabilities() from public,anon,authenticated;
grant execute on function public.community_capabilities() to anon,authenticated,service_role;
create function public.community_release_preflight() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (public.community_capabilities()->>'version')::integer<>20261013 then raise exception 'Complete the entire release migration chain before writing';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.dm_assets'::regclass and conname='dm_assets_storage_object_id_fkey' and confdeltype='r')
 or not exists(select 1 from pg_constraint where conrelid='public.user_assets'::regclass and conname='user_assets_storage_object_id_fkey' and confdeltype='r')
 or (select count(*) from pg_trigger where tgname in ('dm_registration_guard','community_registration_guard','content_new_category','site_settings_release') and tgenabled='O')<>4
 then raise exception 'Release protection is incomplete; stop before writing';end if;
 return jsonb_build_object('version',20261013,'legacy_owner_id',(select legacy_author_id from public.community_publication_config where singleton));
end $$;
revoke all on function public.community_release_preflight() from public,anon,authenticated;
grant execute on function public.community_release_preflight() to service_role;
notify pgrst,'reload schema';
commit;
