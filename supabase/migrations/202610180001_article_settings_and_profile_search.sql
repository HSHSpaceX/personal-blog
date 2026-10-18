-- Round 2: forward only. No Storage/Auth configuration or historical content changes.
begin;

-- Administrative intent belongs to a draft, never to the author's body JSON.
create table public.community_article_preferences (
 revision_id uuid primary key references public.content_revisions(id) on delete restrict,
 featured boolean not null,
 applied_at timestamptz
);
alter table public.community_article_preferences enable row level security;
revoke all on public.community_article_preferences from public,anon,authenticated;
grant select on public.community_article_preferences to authenticated;
create policy article_preferences_owner_admin on public.community_article_preferences
 for select to authenticated using (public.is_admin() and exists (
  select 1 from public.content_revisions r join public.content_items i on i.id=r.item_id
  where r.id=revision_id and i.author_id=auth.uid() and i.content_type='article'));

create function public.community_save_featured_preference(p_revision_id uuid,p_featured boolean) returns void
language plpgsql security definer set search_path='' as $$
declare owner uuid; target uuid; r public.content_revisions;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_featured is null then raise exception 'Invalid featured state' using errcode='22023';end if;
 select i.author_id,i.id into owner,target from public.content_revisions v join public.content_items i on i.id=v.item_id
 where v.id=p_revision_id and i.content_type='article' and i.deleted_at is null;
 if owner is distinct from auth.uid() then raise exception 'Own article required' using errcode='42501';end if;
 perform public.community_cycle_lock(owner,'article');
 perform 1 from public.content_items where id=target for update;
 select * into r from public.content_revisions where id=p_revision_id for update;
 if r.status<>'draft' then raise exception 'Draft required' using errcode='22023';end if;
 insert into public.community_article_preferences(revision_id,featured) values(p_revision_id,p_featured)
 on conflict(revision_id) do update set featured=excluded.featured;
end; $$;

create or replace function public.community_set_featured(p_item_id uuid,p_featured boolean) returns void
language plpgsql security definer set search_path='' as $$
declare i public.content_items; article_title text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_featured is null then raise exception 'Invalid featured state' using errcode='22023';end if;
 select * into i from public.content_items where id=p_item_id for update;
 select r.title into article_title from public.content_revisions r where r.id=i.published_revision_id and r.item_id=i.id and r.status='approved';
 if i.id is null or i.deleted_at is not null or i.content_type<>'article' or article_title is null then raise exception 'Published article required' using errcode='22023';end if;
 if i.featured=p_featured then return;end if;
 update public.content_items set featured=p_featured where id=i.id;
 update public.community_publication_state set status='pending',last_error=null where item_id=i.id;
 insert into public.community_management_audit(actor_id,action,item_id,details) values(auth.uid(),'set_featured',i.id,jsonb_build_object('featured',p_featured));
 if p_featured and i.author_id<>auth.uid() then
  insert into public.notifications(user_id,actor_id,type,title,body,revision_id,target_type,target_id)
  values(i.author_id,auth.uid(),'content_featured','文章已入选精选',
   '你的文章《'||left(article_title,160)||'》已被选为精选文章。',i.published_revision_id,'content',i.id::text);
 end if;
end; $$;

-- Reuses the existing approval policy; approval and featuring commit together.
-- An acknowledged or response-lost retry cannot create a revision/review/notification
-- or undo a later decision made in the featured management center.
create function public.community_submit_featured_article(p_revision_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i public.content_items; r public.content_revisions; owner uuid; target uuid; preference public.community_article_preferences;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 select v.author_id,v.id into owner,target from public.content_items v join public.content_revisions x on x.item_id=v.id
 where x.id=p_revision_id and v.content_type='article' and v.deleted_at is null;
 if owner is distinct from auth.uid() then raise exception 'Own article required' using errcode='42501';end if;
 perform public.community_cycle_lock(owner,'article');
 select * into i from public.content_items where id=target for update;
 select * into r from public.content_revisions where id=p_revision_id for update;
 select * into preference from public.community_article_preferences where revision_id=r.id;
 if preference.applied_at is not null and r.status='approved' and i.published_revision_id=r.id then return;end if;
 if r.status<>'draft' then raise exception 'Draft required' using errcode='22023';end if;
 insert into public.community_article_preferences(revision_id,featured) values(r.id,i.featured) on conflict do nothing;
 select * into strict preference from public.community_article_preferences where revision_id=r.id;
 perform public.community_submit_revision(r.id);
 perform public.community_set_featured(i.id,preference.featured);
 update public.community_article_preferences set applied_at=now() where revision_id=r.id;
end; $$;

revoke all on function public.community_save_featured_preference(uuid,boolean),public.community_submit_featured_article(uuid) from public,anon,authenticated;
grant execute on function public.community_save_featured_preference(uuid,boolean),public.community_submit_featured_article(uuid) to authenticated;

-- Literal substring matching: %, _ and backslash have no wildcard meaning.
-- No empty-keyword enumeration, bounded pages, only existing public fields.
create function public.profile_search(p_query text,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,username text,display_name text,avatar_url text,bio text)
language plpgsql stable security definer set search_path='' as $$
declare needle text:=lower(btrim(p_query));
begin
 if needle is null or char_length(needle) not between 2 and 80 or p_limit is null or p_limit not between 1 and 20
 or p_offset is null or p_offset not between 0 and 200 then raise exception 'Invalid public search page' using errcode='22023';end if;
 return query select p.id,p.username,p.display_name,p.avatar_url,p.bio from public.profiles p
 where strpos(lower(p.username),needle)>0 or strpos(lower(p.display_name),needle)>0 or strpos(lower(coalesce(p.bio,'')),needle)>0
 order by (case when lower(p.username)=needle then 400 when starts_with(lower(p.username),needle) then 300
 when lower(p.display_name)=needle then 250 when strpos(lower(p.username),needle)>0 then 200
 when starts_with(lower(p.display_name),needle) then 150 when strpos(lower(p.display_name),needle)>0 then 100 else 10 end) desc,
 lower(p.username),p.id limit p_limit offset p_offset;
end; $$;
revoke all on function public.profile_search(text,integer,integer) from public,anon,authenticated;
grant execute on function public.profile_search(text,integer,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
