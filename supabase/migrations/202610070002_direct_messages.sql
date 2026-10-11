-- One-to-one private conversations. Admin role deliberately grants nothing.
begin;
create table public.dm_threads (
 id uuid primary key default gen_random_uuid(), user_low uuid not null references auth.users(id) on delete cascade,
 user_high uuid not null references auth.users(id) on delete cascade, unique(user_low,user_high), check(user_low<user_high),
 last_no bigint not null default 0, low_read_no bigint not null default 0, high_read_no bigint not null default 0,
 created_at timestamptz not null default now(), last_message_at timestamptz,
 check(low_read_no between 0 and last_no and high_read_no between 0 and last_no)
);
create table public.dm_messages (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.dm_threads(id) on delete cascade,
 message_no bigint not null check(message_no>0), unique(thread_id,message_no),
 sender_id uuid not null references auth.users(id) on delete cascade,
 body text not null check(char_length(body)<=4000), created_at timestamptz not null default now()
);
create index dm_messages_history on public.dm_messages(thread_id,message_no desc);
create table public.dm_assets (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 storage_object_id uuid not null unique references storage.objects(id) on delete cascade,
 object_path text not null unique, original_name text not null check(char_length(original_name) between 1 and 255),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 size_bytes bigint not null check(size_bytes between 1 and 8388608), created_at timestamptz not null default now()
);
create table public.dm_message_assets (
 message_id uuid not null references public.dm_messages(id) on delete cascade,
 asset_id uuid not null unique references public.dm_assets(id) on delete no action deferrable initially deferred,
 position smallint not null check(position between 0 and 3), primary key(message_id,asset_id), unique(message_id,position)
);
create table public.dm_asset_delete_intents (
 owner_id uuid not null references auth.users(id) on delete cascade, object_path text not null,
 kind text not null check(kind in ('registered','orphan')), primary key(owner_id,object_path)
);
alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_assets enable row level security;
alter table public.dm_message_assets enable row level security;
alter table public.dm_asset_delete_intents enable row level security;
revoke all on public.dm_threads,public.dm_messages,public.dm_assets,public.dm_message_assets,public.dm_asset_delete_intents from public,anon,authenticated;
grant select on public.dm_threads,public.dm_messages,public.dm_assets,public.dm_message_assets to authenticated;
create policy dm_threads_participants on public.dm_threads for select to authenticated
 using((select auth.uid()) in (user_low,user_high));
create policy dm_messages_participants on public.dm_messages for select to authenticated
 using(exists(select 1 from public.dm_threads t where t.id=thread_id and (select auth.uid()) in (t.user_low,t.user_high)));
create policy dm_message_assets_participants on public.dm_message_assets for select to authenticated
 using(exists(select 1 from public.dm_messages m join public.dm_threads t on t.id=m.thread_id
 where m.id=message_id and (select auth.uid()) in (t.user_low,t.user_high)));
create policy dm_assets_private on public.dm_assets for select to authenticated
 using(owner_id=(select auth.uid()) or exists(select 1 from public.dm_message_assets a
 join public.dm_messages m on m.id=a.message_id join public.dm_threads t on t.id=m.thread_id
 where a.asset_id=dm_assets.id and (select auth.uid()) in (t.user_low,t.user_high)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dm-media','dm-media',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create unique index dm_media_object_path on storage.objects(bucket_id,name) where bucket_id='dm-media';
create function public.dm_can_read_object(p_object_id uuid,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and ((storage.foldername(p_path))[1]=auth.uid()::text or exists(
 select 1 from public.dm_assets a join public.dm_message_assets ma on ma.asset_id=a.id
 join public.dm_messages m on m.id=ma.message_id join public.dm_threads t on t.id=m.thread_id
 where a.storage_object_id=p_object_id and a.object_path=p_path and auth.uid() in (t.user_low,t.user_high)));
$$;
create policy dm_media_read on storage.objects for select to authenticated
 using(bucket_id='dm-media' and public.dm_can_read_object(id,name));
create policy dm_media_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'dm-media' or (auth.uid() is not null and public.dm_can_read_object(id,name)));
create policy dm_media_guest_read_guard on storage.objects as restrictive for select to anon using(bucket_id<>'dm-media');
create policy dm_media_insert on storage.objects for insert to authenticated
 with check(bucket_id='dm-media' and (storage.foldername(name))[1]=auth.uid()::text
 and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$');
create policy dm_media_insert_guard on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'dm-media' or (auth.uid() is not null and (storage.foldername(name))[1]=auth.uid()::text
 and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$'));
create policy dm_media_delete on storage.objects for delete to authenticated
 using(bucket_id='dm-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy dm_media_delete_guard on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'dm-media' or (auth.uid() is not null and (storage.foldername(name))[1]=auth.uid()::text));
create policy dm_media_update_guard on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'dm-media') with check(bucket_id<>'dm-media');
create function public.dm_guard_object() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and exists(select 1 from public.dm_assets a join public.dm_message_assets ma on ma.asset_id=a.id where a.storage_object_id=old.id) then
  raise exception 'Sent images cannot be deleted' using errcode='23503';end if;
 if tg_op='UPDATE' and exists(select 1 from public.dm_assets where storage_object_id=old.id) then
  raise exception 'Registered DM images are immutable' using errcode='23514'; end if;
 if tg_op='DELETE' and exists(select 1 from public.dm_asset_delete_intents d where d.object_path=old.name
 and d.owner_id::text=(storage.foldername(old.name))[1] and d.kind='orphan') and
 exists(select 1 from public.dm_assets a where a.storage_object_id=old.id or a.object_path=old.name) then
  raise exception 'Orphan became registered' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if;return new;
end; $$;
create trigger dm_media_immutable before update on storage.objects for each row
 when(old.bucket_id='dm-media') execute function public.dm_guard_object();
create trigger dm_media_orphan_guard before delete on storage.objects for each row
 when(old.bucket_id='dm-media') execute function public.dm_guard_object();
create function public.dm_clear_delete_intent() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from public.dm_asset_delete_intents where object_path=old.name and owner_id::text=(storage.foldername(old.name))[1];return old;end; $$;
create trigger dm_media_delete_cleanup after delete on storage.objects for each row
 when(old.bucket_id='dm-media') execute function public.dm_clear_delete_intent();

create function public.dm_get_or_create_thread(p_target_user_id uuid,p_expected_user_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare tid uuid; low_id uuid; high_id uuid;
begin
 if auth.uid() is null or (p_expected_user_id is not null and p_expected_user_id<>auth.uid()) then raise exception 'Login required; account changed' using errcode='42501'; end if;
 if p_target_user_id is null or p_target_user_id=auth.uid() then raise exception 'Cannot message yourself' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles where id=p_target_user_id) then raise exception 'Recipient unavailable' using errcode='42501'; end if;
 low_id:=least(auth.uid(),p_target_user_id);high_id:=greatest(auth.uid(),p_target_user_id);
 insert into public.dm_threads(user_low,user_high) values(low_id,high_id) on conflict(user_low,user_high) do nothing returning id into tid;
 if tid is null then select id into tid from public.dm_threads where user_low=low_id and user_high=high_id;end if;
 return tid;
end; $$;
create function public.dm_threads(p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,peer_id uuid,username text,display_name text,avatar_url text,last_message_at timestamptz,unread_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select t.id,p.id,p.username,p.display_name,p.avatar_url,t.last_message_at,
 (select count(*) from public.dm_messages m where m.thread_id=t.id and m.sender_id<>auth.uid()
 and m.message_no>case when auth.uid()=t.user_low then t.low_read_no else t.high_read_no end)
 from public.dm_threads t join public.profiles p on p.id=case when auth.uid()=t.user_low then t.user_high else t.user_low end
 where auth.uid() in (t.user_low,t.user_high) order by t.last_message_at desc nulls last,t.created_at desc,t.id desc limit p_limit offset p_offset;
end; $$;
create function public.dm_messages(p_thread_id uuid,p_limit integer default 20,p_before_no bigint default null)
returns table(id uuid,message_no bigint,sender_id uuid,body text,created_at timestamptz,assets jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.dm_threads t where t.id=p_thread_id and auth.uid() in (t.user_low,t.user_high)) then
 raise exception 'Thread unavailable' using errcode='42501';end if;
 perform public.community_check_page(p_limit,0);
 if p_before_no is not null and p_before_no<1 then raise exception 'Invalid message cursor' using errcode='22023';end if;
 return query select m.id,m.message_no,m.sender_id,m.body,m.created_at,
 coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'original_name',a.original_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes) order by ma.position)
 from public.dm_message_assets ma join public.dm_assets a on a.id=ma.asset_id where ma.message_id=m.id),'[]'::jsonb)
 from public.dm_messages m where m.thread_id=p_thread_id and (p_before_no is null or m.message_no<p_before_no)
 order by m.message_no desc limit p_limit;
end; $$;
create function public.dm_register_asset(p_object_path text,p_original_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; aid uuid; mime text; bytes bigint;
begin
 if auth.uid() is null or split_part(p_object_path,'/',1) is distinct from auth.uid()::text then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_original_name is null or char_length(p_original_name)>255 or char_length(btrim(p_original_name))<1 then raise exception 'Invalid image name' using errcode='22023';end if;
 if p_object_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$' then raise exception 'Invalid image path' using errcode='22023';end if;
 select * into obj from storage.objects where bucket_id='dm-media' and name=p_object_path for share;
 if obj.id is null then raise exception 'Upload the private image first' using errcode='22023';end if;
 mime:=obj.metadata->>'mimetype';
 if obj.metadata->>'size' is null or obj.metadata->>'size' !~ '^[0-9]{1,9}$' then raise exception 'Invalid image metadata' using errcode='22023';end if;
 bytes:=(obj.metadata->>'size')::bigint;
 if mime is null or mime not in ('image/jpeg','image/png','image/webp') or bytes not between 1 and 8388608 or
 split_part(p_object_path,'.',2)<>(case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end) then
 raise exception 'Unsupported image metadata' using errcode='22023';end if;
 insert into public.dm_assets(owner_id,storage_object_id,object_path,original_name,mime_type,size_bytes)
 values(auth.uid(),obj.id,p_object_path,p_original_name,mime,bytes) returning id into aid;return aid;
end; $$;
create function public.dm_send_message(p_thread_id uuid,p_body text,p_asset_ids uuid[] default '{}',p_expected_sender_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.dm_threads; a public.dm_assets; obj storage.objects; aid uuid; mid uuid; recipient uuid;
begin
 select * into t from public.dm_threads where id=p_thread_id for update;
 if auth.uid() is null or t.id is null or auth.uid() not in (t.user_low,t.user_high) or
 (p_expected_sender_id is not null and p_expected_sender_id<>auth.uid()) then raise exception 'Thread unavailable; account changed' using errcode='42501';end if;
 if p_body is null or char_length(p_body)>4000 or p_asset_ids is null or cardinality(p_asset_ids)>4 or
 coalesce(array_ndims(p_asset_ids),1)<>1 or exists(select 1 from unnest(p_asset_ids) v(id) where id is null) or
 (select count(distinct id) from unnest(p_asset_ids) v(id))<>cardinality(p_asset_ids) or
 (char_length(btrim(p_body))=0 and cardinality(p_asset_ids)=0) then raise exception 'Invalid message body or images' using errcode='22023';end if;
 -- Object-before-registry locks match Storage deletion; deterministic asset
 -- ordering also serializes attempts to attach the same image to two threads.
 for aid in select id from unnest(p_asset_ids) v(id) order by id loop
  select * into a from public.dm_assets where id=aid and owner_id=auth.uid();
  if a.id is null then raise exception 'Asset unavailable' using errcode='42501';end if;
  select * into obj from storage.objects where id=a.storage_object_id and bucket_id='dm-media' for share;
  if obj.id is null then raise exception 'Asset unavailable' using errcode='42501';end if;
  perform 1 from public.dm_assets where id=aid for update;
  if not found or exists(select 1 from public.dm_message_assets where asset_id=aid) then raise exception 'Image already sent or unavailable' using errcode='22023';end if;
  if obj.name<>a.object_path or obj.metadata->>'mimetype' is distinct from a.mime_type or
    obj.metadata->>'size' is distinct from a.size_bytes::text then raise exception 'Image metadata changed' using errcode='22023';end if;
 end loop;
 recipient:=case when auth.uid()=t.user_low then t.user_high else t.user_low end;
 insert into public.dm_messages(thread_id,message_no,sender_id,body) values(t.id,t.last_no+1,auth.uid(),p_body) returning id into mid;
 insert into public.dm_message_assets(message_id,asset_id,position) select mid,id,(ordinality-1)::smallint from unnest(p_asset_ids) with ordinality v(id,ordinality);
 update public.dm_threads set last_no=t.last_no+1,last_message_at=clock_timestamp() where id=t.id;
 insert into public.notifications(user_id,actor_id,type,title,body,dm_thread_id,dm_message_id)
 values(recipient,auth.uid(),'direct_message','收到新私信','',t.id,mid);
 return mid;
end; $$;
alter table public.notifications add column dm_thread_id uuid references public.dm_threads(id) on delete cascade;
alter table public.notifications add column dm_message_id uuid references public.dm_messages(id) on delete cascade;
create index notifications_dm_read on public.notifications(user_id,dm_thread_id) where type='direct_message' and not read;
create function public.dm_mark_thread_read(p_thread_id uuid,p_through_no bigint default null,p_expected_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.dm_threads; cutoff bigint;
begin
 select * into t from public.dm_threads where id=p_thread_id for update;
 if auth.uid() is null or t.id is null or auth.uid() not in (t.user_low,t.user_high) or
 (p_expected_user_id is not null and p_expected_user_id<>auth.uid()) then raise exception 'Thread unavailable; account changed' using errcode='42501';end if;
 cutoff:=coalesce(p_through_no,t.last_no);
 if cutoff not between 0 and t.last_no then raise exception 'Invalid read cursor' using errcode='22023';end if;
 if auth.uid()=t.user_low then update public.dm_threads set low_read_no=greatest(low_read_no,cutoff) where id=t.id;
 else update public.dm_threads set high_read_no=greatest(high_read_no,cutoff) where id=t.id;end if;
 update public.notifications n set read=true from public.dm_messages m where n.dm_message_id=m.id
 and n.user_id=auth.uid() and n.dm_thread_id=t.id and m.message_no<=cutoff and not n.read;
end; $$;
create function public.dm_unread_count() returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.dm_messages m join public.dm_threads t on t.id=m.thread_id
 where auth.uid() in (t.user_low,t.user_high) and m.sender_id<>auth.uid()
 and m.message_no>case when auth.uid()=t.user_low then t.low_read_no else t.high_read_no end;
$$;
create function public.dm_unsent_assets(p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,original_name text,mime_type text,size_bytes bigint,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select a.id,a.original_name,a.mime_type,a.size_bytes,a.created_at from public.dm_assets a
 where a.owner_id=auth.uid() and not exists(select 1 from public.dm_message_assets where asset_id=a.id)
 order by a.created_at desc,a.id desc limit p_limit offset p_offset;
end; $$;
create function public.dm_orphan_assets(p_limit integer default 20,p_offset integer default 0)
returns table(object_id uuid,object_path text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select o.id,o.name from storage.objects o where o.bucket_id='dm-media' and (storage.foldername(o.name))[1]=auth.uid()::text
 and not exists(select 1 from public.dm_assets a where a.storage_object_id=o.id or a.object_path=o.name)
 order by o.name,o.id limit p_limit offset p_offset;
end; $$;
create function public.dm_prepare_asset_delete(p_asset_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare a public.dm_assets;
begin
 select * into a from public.dm_assets where id=p_asset_id and owner_id=auth.uid();
 if auth.uid() is null or a.id is null then raise exception 'Asset unavailable' using errcode='42501';end if;
 if exists(select 1 from public.dm_message_assets where asset_id=a.id) then raise exception 'Sent images cannot be deleted' using errcode='23503';end if;
 insert into public.dm_asset_delete_intents(owner_id,object_path,kind) values(auth.uid(),a.object_path,'registered')
 on conflict(owner_id,object_path) do update set kind='registered';return a.object_path;
end; $$;
create function public.dm_prepare_orphan_delete(p_object_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare obj storage.objects;
begin
 select * into obj from storage.objects where id=p_object_id and bucket_id='dm-media' and (storage.foldername(name))[1]=auth.uid()::text for share;
 if auth.uid() is null or obj.id is null then raise exception 'Orphan unavailable' using errcode='42501';end if;
 if exists(select 1 from public.dm_assets where storage_object_id=obj.id or object_path=obj.name) then raise exception 'Object is registered' using errcode='23514';end if;
 insert into public.dm_asset_delete_intents(owner_id,object_path,kind) values(auth.uid(),obj.name,'orphan')
 on conflict(owner_id,object_path) do update set kind='orphan';return obj.name;
end; $$;
create function public.notifications_page(p_limit integer default 20,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform public.community_check_page(p_limit,p_offset);
 return query select jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'body',n.body,'read',n.read,'created_at',n.created_at,
 'revision_id',n.revision_id,'comment_edit_id',n.comment_edit_id,'comment_id',n.comment_id,'dm_thread_id',n.dm_thread_id,
 'target_type',n.target_type,'target_id',n.target_id,
 'target_username',case when n.target_type='content' then public.community_public_target('content',n.target_id)->>'username' else null end,
 'actorName',coalesce(nullif(p.display_name,''),p.username),'actorUsername',p.username,'actorAvatar',p.avatar_url)
 from public.notifications n left join public.profiles p on p.id=n.actor_id where n.user_id=auth.uid()
 order by n.created_at desc,n.id desc limit p_limit offset p_offset;
end; $$;
revoke all on function public.dm_guard_object(),public.dm_clear_delete_intent() from public,anon,authenticated;
revoke all on function public.dm_can_read_object(uuid,text),public.dm_get_or_create_thread(uuid,uuid),public.dm_threads(integer,integer),
 public.dm_messages(uuid,integer,bigint),public.dm_register_asset(text,text),public.dm_send_message(uuid,text,uuid[],uuid),
 public.dm_mark_thread_read(uuid,bigint,uuid),public.dm_unread_count(),public.dm_unsent_assets(integer,integer),
 public.dm_orphan_assets(integer,integer),public.dm_prepare_asset_delete(uuid),public.dm_prepare_orphan_delete(uuid),
 public.notifications_page(integer,integer) from public,anon,authenticated;
grant execute on function public.dm_can_read_object(uuid,text),public.dm_get_or_create_thread(uuid,uuid),public.dm_threads(integer,integer),
 public.dm_messages(uuid,integer,bigint),public.dm_register_asset(text,text),public.dm_send_message(uuid,text,uuid[],uuid),
 public.dm_mark_thread_read(uuid,bigint,uuid),public.dm_unread_count(),public.dm_unsent_assets(integer,integer),
 public.dm_orphan_assets(integer,integer),public.dm_prepare_asset_delete(uuid),public.dm_prepare_orphan_delete(uuid),
 public.notifications_page(integer,integer) to authenticated;
commit;
