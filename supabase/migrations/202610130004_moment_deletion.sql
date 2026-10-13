begin;
alter table public.content_items add column deleted_at timestamptz;
alter table public.content_items add column draft_title text;
create function public.community_create_album(p_slug text,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.content_items; new_id uuid;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 160 then raise exception 'Album title required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('album:'||p_slug,0));
 select * into i from public.content_items where content_type='album' and slug=p_slug;
 if found then
  if i.author_id<>auth.uid() or i.draft_title is distinct from btrim(p_title) then raise exception 'Album request conflict' using errcode='22023';end if;
  return i.id;
 end if;
 new_id:=public.community_create_item('album',p_slug);
 update public.content_items set draft_title=btrim(p_title) where id=new_id;
 return new_id;
end $$;
revoke all on function public.community_create_album(text,text) from public,anon,authenticated;
grant execute on function public.community_create_album(text,text) to authenticated;
create function public.community_delete_moment(p_item_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.content_items;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 -- The cycle lock serializes deletion with submit/review, retaining first-approval counts.
 perform public.community_cycle_lock(auth.uid(),'moment');
 select * into i from public.content_items where id=p_item_id for update;
 if i.author_id is distinct from auth.uid() or i.content_type<>'moment' then raise exception 'Only your own moment can be deleted' using errcode='42501';end if;
 if i.deleted_at is not null then return;end if;
 if exists(select 1 from public.content_reviews where item_id=i.id and status='pending') then raise exception 'Pending review must be resolved before deleting this moment' using errcode='22023';end if;
 update public.content_items set published_revision_id=null,deleted_at=now() where id=i.id;
 insert into public.community_management_audit(actor_id,action,item_id,details) values(auth.uid(),'delete_moment',i.id,jsonb_build_object('previous_revision',i.published_revision_id));
end $$;
create function public.community_guard_deleted_content() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.content_items where id=new.item_id and deleted_at is not null) then raise exception 'Deleted content is retained for recovery and cannot be edited or published' using errcode='22023';end if;return new;
end $$;
create trigger content_deleted_guard before insert or update on public.content_revisions for each row execute function public.community_guard_deleted_content();
create function public.community_deleted_export() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'type',i.content_type,'legacy_id',m.target_id) order by i.id),'[]'::jsonb)
 from public.content_items i left join public.community_legacy_mappings m on m.item_id=i.id where i.deleted_at is not null;
$$;
revoke all on function public.community_guard_deleted_content(),public.community_deleted_export(),public.community_delete_moment(uuid) from public,anon,authenticated;
grant execute on function public.community_delete_moment(uuid) to authenticated;
grant execute on function public.community_deleted_export() to service_role;
-- Mapped deleted legacy entries must not become publicly visible again through fallback APIs.
alter function public.community_public_target(text,text) rename to community_public_target_before_deletion;
create function public.community_public_target(p_type text,p_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.content_items i left join public.community_legacy_mappings m on m.item_id=i.id
 where i.deleted_at is not null and ((p_type='content' and i.id::text=p_id) or (m.target_type=p_type and m.target_id=p_id))) then null
 else public.community_public_target_before_deletion(p_type,p_id) end;
$$;
revoke all on function public.community_public_target(text,text),public.community_public_target_before_deletion(text,text) from public,anon,authenticated;
create function public.community_review_count() returns bigint language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 return (select count(*) from public.content_reviews where status='pending')+(select count(*) from public.comments where status='pending')+(select count(*) from public.comment_edits where status='pending');
end $$;
revoke all on function public.community_review_count() from public,anon,authenticated;
grant execute on function public.community_review_count() to authenticated;
-- The version is enabled only at the end of the complete forward chain.
create or replace function public.community_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',case when
 exists(select 1 from pg_constraint where conrelid='public.dm_assets'::regclass and conname='dm_assets_storage_object_id_fkey' and confdeltype='r')
 and exists(select 1 from pg_constraint where conrelid='public.user_assets'::regclass and conname='user_assets_storage_object_id_fkey' and confdeltype='r')
 and (select count(*) from pg_trigger where tgrelid in ('public.dm_assets'::regclass,'public.user_assets'::regclass,'public.content_revisions'::regclass,'public.community_site_settings'::regclass) and tgname in ('dm_registration_guard','community_registration_guard','content_new_category','site_settings_release','content_deleted_guard') and tgenabled='O')=5
 and to_regprocedure('public.community_review_entry(text,uuid,text,text,text)') is not null
 and to_regprocedure('public.community_review_queue(text,text,text,boolean,integer,integer)') is not null
 and to_regprocedure('public.community_create_album(text,text)') is not null
 and to_regprocedure('public.community_deleted_export()') is not null
 and to_regprocedure('public.private_object_finish_deletes()') is not null
 then 20261013 else 0 end,'categories',public.community_article_categories());
$$;
notify pgrst,'reload schema';
commit;
