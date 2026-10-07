-- Round 5: service-only full reconciliation. Never apply from the browser.
begin;
create table public.community_publication_config (
 singleton boolean primary key default true check(singleton),
 legacy_author_id uuid references public.profiles(id) on delete set null
);
insert into public.community_publication_config(singleton) values(true);
create table public.community_publication_state (
 item_id uuid primary key references public.content_items(id) on delete cascade,
 desired_revision_id uuid not null,
 status text not null default 'pending' check(status in ('pending','published','failed')),
 published_revision_id uuid,
 last_attempt_at timestamptz, published_at timestamptz,
 last_error text check(last_error in ('EXPORT_FAILED','INVALID_SNAPSHOT','INVALID_MEDIA','STORAGE_FAILED','GIT_FAILED','FINALIZE_FAILED')),
 commit_sha text check(commit_sha ~ '^[0-9a-f]{40}$')
);
alter table public.community_publication_state enable row level security;
alter table public.community_publication_config enable row level security;
revoke all on public.community_publication_state,public.community_publication_config from public,anon,authenticated;
grant select on public.community_publication_state to authenticated;
grant select,insert,update,delete on public.community_publication_state,public.community_publication_config to service_role;
create policy publication_state_owner on public.community_publication_state for select to authenticated
 using(exists(select 1 from public.content_items i where i.id=item_id and (i.author_id=auth.uid() or public.is_admin())));
create function public.community_publication_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.published_revision_id is not distinct from old.published_revision_id then return new;end if;
 if new.published_revision_id is not null then
  insert into public.community_publication_state(item_id,desired_revision_id) values(new.id,new.published_revision_id)
  on conflict(item_id) do update set desired_revision_id=excluded.desired_revision_id,status='pending',last_error=null;
 else delete from public.community_publication_state where item_id=new.id;end if;
 return new;
end; $$;
create trigger community_publication_changed after insert or update of published_revision_id on public.content_items
 for each row execute function public.community_publication_changed();
insert into public.community_publication_state(item_id,desired_revision_id)
 select i.id,i.published_revision_id from public.content_items i join public.content_revisions r on r.id=i.published_revision_id and r.status='approved';
-- Single SQL statement gives a consistent authority snapshot. Private asset metadata
-- is exported only to the service publisher, never to public JSON.
create function public.community_publication_export() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'revision_id',r.id,'content_type',i.content_type,'slug',i.slug,
 'title',r.title,'body',r.body,'published_at',r.resolved_at,
 'author',jsonb_build_object('username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
 'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'owner_id',a.owner_id,'bucket_id',a.bucket_id,
 'object_path',a.object_path,'original_name',a.original_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes,
 'storage_metadata',o.metadata) order by a.id) from public.revision_assets ra join public.user_assets a on a.id=ra.asset_id
 join storage.objects o on o.id=a.storage_object_id and o.bucket_id='community-assets' and o.name=a.object_path
 where ra.revision_id=r.id),'[]'::jsonb)) order by i.id),'[]'::jsonb)
 from public.content_items i join public.content_revisions r on r.id=i.published_revision_id and r.status='approved'
 join public.profiles p on p.id=i.author_id;
$$;
create function public.community_publication_result(p_item_id uuid,p_revision_id uuid,p_status text,p_commit_sha text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('pending','published','failed') or
 (p_status='published' and (p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$')) then
 raise exception 'Invalid publication result' using errcode='22023';end if;
 -- Lock the authority row: an old worker cannot mark a newer pointer published.
 perform 1 from public.content_items where id=p_item_id and published_revision_id=p_revision_id for update;
 if not found then return false;end if;
 if p_status='pending' and exists(select 1 from public.community_publication_state where item_id=p_item_id and status='published' and published_revision_id=p_revision_id) then return true;end if;
 update public.community_publication_state set status=p_status,last_attempt_at=now(),last_error=p_error,
 published_revision_id=case when p_status='published' then p_revision_id else published_revision_id end,
 published_at=case when p_status='published' then case when published_revision_id=p_revision_id and commit_sha=p_commit_sha then coalesce(published_at,now()) else now() end else published_at end,
 commit_sha=case when p_status='published' then p_commit_sha else commit_sha end
 where item_id=p_item_id and desired_revision_id=p_revision_id;
 return found;
end; $$;
-- Trusted repository catalogue replaces the full legacy desired state. Owner is
-- configured once by service/operator UUID; client names never determine ownership.
create function public.community_sync_legacy_targets(p_targets jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v jsonb; owner uuid;
begin
 if jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets)>100000 then raise exception 'Invalid catalogue';end if;
 select legacy_author_id into owner from public.community_publication_config where singleton;
 create temporary table if not exists community_legacy_stage (like public.legacy_public_targets including defaults) on commit drop;
 truncate pg_temp.community_legacy_stage;
 for v in select value from jsonb_array_elements(p_targets) loop
  if v->>'target_type' not in ('post','moment','album') or v->>'target_id' !~ '^[a-zA-Z0-9_-]{1,160}$' or
   v->>'target_path' is distinct from (case v->>'target_type' when 'post' then case when v->>'target_id'='about' then 'about.html#commentsSection' else 'posts/'||(v->>'target_id')||'.html' end
    when 'moment' then 'moments.html#moment-'||(v->>'target_id') else 'gallery.html?album='||(v->>'target_id') end) then
   raise exception 'Invalid catalogue target';end if;
  insert into pg_temp.community_legacy_stage(target_type,target_id,title,excerpt,target_path,published_at,author_id)
   values(v->>'target_type',v->>'target_id',left(v->>'title',160),left(v->>'excerpt',500),v->>'target_path',(v->>'published_at')::timestamptz,owner);
 end loop;
 delete from public.legacy_public_targets t where not exists(select 1 from pg_temp.community_legacy_stage s where s.target_type=t.target_type and s.target_id=t.target_id);
 insert into public.legacy_public_targets select * from pg_temp.community_legacy_stage
 on conflict(target_type,target_id) do update set title=excluded.title,excerpt=excluded.excerpt,target_path=excluded.target_path,published_at=excluded.published_at,author_id=excluded.author_id;
end; $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('published-media','published-media',true,20971520,array['image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain']);
create policy published_media_read on storage.objects for select to anon,authenticated using(bucket_id='published-media');
create policy published_media_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'published-media');
create policy published_media_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'published-media') with check(bucket_id<>'published-media');
create policy published_media_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'published-media');
revoke all on function public.community_publication_changed(),public.community_publication_export(),
 public.community_publication_result(uuid,uuid,text,text,text),public.community_sync_legacy_targets(jsonb) from public,anon,authenticated;
grant execute on function public.community_publication_export(),public.community_publication_result(uuid,uuid,text,text,text),public.community_sync_legacy_targets(jsonb) to service_role;
create or replace function public.community_validate_body(p_type text,p_body jsonb) returns uuid[]
language plpgsql immutable set search_path='' as $$
declare allowed text[]; v jsonb; entry jsonb; ids uuid[] := '{}'; asset uuid;
begin
  if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>1048576 then
    raise exception 'Invalid content schema' using errcode='22023'; end if;
  allowed := case p_type when 'article' then array['text','summary','tags','asset_ids','category']
    when 'moment' then array['text','asset_ids'] when 'album' then array['description','photos'] end;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_body) k where not(k=any(allowed))) then
    raise exception 'Invalid content fields' using errcode='22023'; end if;
  if p_body ? 'category' and (jsonb_typeof(p_body->'category')<>'string' or char_length(btrim(p_body->>'category')) not between 1 and 40 or (p_body->>'category') ~ '[<>]') then
    raise exception 'Invalid article category' using errcode='22023'; end if;
  if p_type in ('article','moment') then
    if jsonb_typeof(p_body->'text') is distinct from 'string' or
      char_length(btrim(p_body->>'text'))<1 or
      char_length(p_body->>'text')>(case when p_type='article' then 100000 else 2000 end) then
      raise exception 'Invalid content text' using errcode='22023'; end if;
  end if;
  foreach v in array array[p_body->'summary',p_body->'description'] loop
    if v is not null and (jsonb_typeof(v)<>'string' or char_length(v#>>'{}')>
      (case when p_type='album' then 2000 else 500 end)) then
      raise exception 'Invalid content description' using errcode='22023'; end if;
  end loop;
  if p_body ? 'tags' then
    if jsonb_typeof(p_body->'tags')<>'array' or jsonb_array_length(p_body->'tags')>10 then
      raise exception 'Invalid tags' using errcode='22023'; end if;
    for v in select value from jsonb_array_elements(p_body->'tags') loop
      if jsonb_typeof(v)<>'string' or char_length(btrim(v#>>'{}'))<1 or char_length(v#>>'{}')>30 then
        raise exception 'Invalid tag' using errcode='22023'; end if;
    end loop;
  end if;
  if p_type='album' then
    if jsonb_typeof(p_body->'photos') is distinct from 'array' or jsonb_array_length(p_body->'photos') not between 1 and 100 then
      raise exception 'An album needs 1 to 100 photos' using errcode='22023'; end if;
    for entry in select value from jsonb_array_elements(p_body->'photos') loop
      if jsonb_typeof(entry)<>'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('asset_id','caption'))
        or jsonb_typeof(entry->'asset_id') is distinct from 'string' or
        ((entry ? 'caption') and (jsonb_typeof(entry->'caption')<>'string' or char_length(entry->>'caption')>200)) then
        raise exception 'Invalid album photo' using errcode='22023'; end if;
      if (entry->>'asset_id') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
        raise exception 'Invalid asset UUID' using errcode='22023'; end if;
      ids:=array_append(ids,(entry->>'asset_id')::uuid);
    end loop;
  elsif p_body ? 'asset_ids' then
    if jsonb_typeof(p_body->'asset_ids')<>'array' or jsonb_array_length(p_body->'asset_ids')>
      (case when p_type='moment' then 9 else 20 end) then
      raise exception 'Invalid asset list' using errcode='22023'; end if;
    for v in select value from jsonb_array_elements(p_body->'asset_ids') loop
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
        raise exception 'Invalid asset UUID' using errcode='22023'; end if;
      ids:=array_append(ids,(v#>>'{}')::uuid);
    end loop;
  end if;
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then
    raise exception 'Duplicate asset reference' using errcode='22023'; end if;
  return ids;
end;
$$;
revoke all on function public.community_validate_body(text,jsonb) from public,anon,authenticated;

create or replace function public.community_public_target(p_type text,p_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_type='content' then (
   select jsonb_build_object('kind',i.content_type,'target_type','content','target_id',i.id::text,
     'slug',i.slug,'revision_id',r.id,'title',r.title,'text',coalesce(r.body->>'text',r.body->>'description',''),
     'body',r.body,'published_at',r.resolved_at,'username',p.username,'display_name',p.display_name,
     'avatar_url',p.avatar_url,'target_path',case i.content_type when 'article' then 'posts/'||i.slug||'.html' when 'moment' then 'moments.html#community-'||i.id::text else 'gallery.html?community='||i.id::text end)
   from public.content_items i join public.content_revisions r on r.id=i.published_revision_id and r.status='approved'
   join public.profiles p on p.id=i.author_id where i.id::text=p_id
 ) else (
   select jsonb_build_object('kind',case t.target_type when 'post' then 'article' else t.target_type end,
     'target_type',t.target_type,'target_id',t.target_id,'title',t.title,'text',t.excerpt,'target_path',t.target_path,
     'published_at',t.published_at,'username','hshspacex','display_name','HSH(站长)','avatar_url','assets/icon.jpg','legacy',true)
   from public.legacy_public_targets t where t.target_type=p_type and t.target_id=p_id
 ) end;
$$;
create or replace function public.notifications_page(p_limit integer default 20,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'body',n.body,'read',n.read,'created_at',n.created_at,
 'revision_id',n.revision_id,'comment_edit_id',n.comment_edit_id,'comment_id',n.comment_id,'dm_thread_id',n.dm_thread_id,
 'target_type',n.target_type,'target_id',n.target_id,
 'target_kind',public.community_public_target(n.target_type,n.target_id)->>'kind',
 'target_slug',public.community_public_target(n.target_type,n.target_id)->>'slug',
 'target_username',case when n.target_type='content' then public.community_public_target('content',n.target_id)->>'username' else null end,
 'actorName',coalesce(nullif(p.display_name,''),p.username),'actorUsername',p.username,'actorAvatar',p.avatar_url)
 from public.notifications n left join public.profiles p on p.id=n.actor_id where n.user_id=auth.uid()
 order by n.created_at desc,n.id desc limit p_limit offset p_offset;
end; $$;
commit;
