-- Unified private media and operator-reviewed legacy import. No production SQL here.
begin;
create function public.community_can_read_asset(p_asset_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.user_assets a where a.id=p_asset_id and
 (a.owner_id=auth.uid() or (public.is_admin() and exists(select 1 from public.revision_assets ra join public.content_reviews r on r.revision_id=ra.revision_id where ra.asset_id=a.id))));
$$;
create policy user_assets_review_scope on public.user_assets as restrictive for select to authenticated using(public.community_can_read_asset(id));
create function public.community_can_read_registered_object(p_object_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.user_assets a where a.storage_object_id=p_object_id and public.community_can_read_asset(a.id));
$$;
revoke all on function public.community_can_read_registered_object(uuid) from public,anon,authenticated;
grant execute on function public.community_can_read_registered_object(uuid) to anon,authenticated;
drop policy community_assets_read_guard on storage.objects;
create policy community_assets_read_guard on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'community-assets' or (auth.uid() is not null and (split_part(name,'/',1)=auth.uid()::text or public.community_can_read_registered_object(id))));
update storage.buckets set file_size_limit=94371840 where id in ('community-assets','published-media');
create or replace function public.community_register_asset(p_object_path text,p_original_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; asset_id uuid; mime text; bytes bigint;
begin
 if auth.uid() is null or split_part(p_object_path,'/',1) is distinct from auth.uid()::text then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_original_name is null or char_length(p_original_name) not between 1 and 255 or char_length(btrim(p_original_name))<1 or p_original_name ~ '[/\\[:cntrl:]]' then raise exception 'Invalid asset name' using errcode='22023';end if;
 select * into obj from storage.objects where bucket_id='community-assets' and name=p_object_path for share;
 if obj.id is null then raise exception 'Upload the private object first' using errcode='22023';end if;
 mime:=obj.metadata->>'mimetype';bytes:=(obj.metadata->>'size')::bigint;
 if mime is null or mime not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain') or bytes is null or bytes not between 1 and 94371840 then raise exception 'Unsupported asset metadata' using errcode='22023';end if;
 insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes,storage_object_id) values(auth.uid(),p_object_path,p_original_name,mime,bytes,obj.id) returning id into asset_id;
 return asset_id;
end; $$;
create table public.community_legacy_mappings (
 item_id uuid primary key references public.content_items(id) on delete cascade,
 target_type text not null check(target_type in ('post','moment','album')), target_id text not null check(target_id ~ '^[a-zA-Z0-9_-]{1,160}$'),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'), published_at timestamptz not null,
 imported_at timestamptz not null default now(), unique(target_type,target_id)
);
alter table public.community_legacy_mappings enable row level security;
revoke all on public.community_legacy_mappings from public,anon,authenticated;
grant select on public.community_legacy_mappings to authenticated;
create policy legacy_mapping_admin_read on public.community_legacy_mappings for select to authenticated using(public.is_admin());
grant select on public.community_legacy_mappings,public.content_items to service_role;
-- Operator service only. Import an existing PUBLIC item, never a private album.
-- Files must already exist in private Storage with a real owner's UUID and immutable registry.
create function public.community_import_legacy(p_owner uuid,p_type text,p_slug text,p_target_id text,p_source_sha256 text,p_title text,p_body jsonb,p_published_at timestamptz,p_featured boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid; r uuid; a uuid; ids uuid[]; existing public.community_legacy_mappings; kind text;
begin
 kind:=case p_type when 'article' then 'post' else p_type end;
 if p_type not in ('article','moment','album') or p_type is null or p_published_at is null or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid legacy manifest' using errcode='22023';end if;
 if p_owner is distinct from (select legacy_author_id from public.community_publication_config where singleton) or p_owner is null then raise exception 'Configured legacy owner required' using errcode='42501';end if;
 perform public.community_cycle_lock(p_owner,p_type);
 select * into existing from public.community_legacy_mappings where target_type=kind and target_id=p_target_id;
 if found then
  if existing.source_sha256<>p_source_sha256 then raise exception 'Legacy source changed; operator review required' using errcode='22023';end if;
  return existing.item_id;
 end if;
 ids:=public.community_validate_body(p_type,p_body);
 if p_title is null or char_length(p_title) not between 1 and 160 or not exists(select 1 from public.profiles where id=p_owner) then raise exception 'Invalid legacy owner/title' using errcode='22023';end if;
 if exists(select 1 from public.content_items where content_type=p_type and slug=p_slug) then raise exception 'Legacy slug collision' using errcode='22023';end if;
 for a in select id from unnest(ids) id order by id loop
  if not exists(select 1 from public.user_assets where id=a and owner_id=p_owner and storage_object_id is not null and (p_type<>'album' or mime_type like 'image/%')) then raise exception 'Legacy asset unavailable' using errcode='42501';end if;
  perform 1 from storage.objects o join public.user_assets u on u.storage_object_id=o.id where u.id=a for share of o;
 end loop;
 insert into public.content_items(author_id,content_type,slug,featured) values(p_owner,p_type,p_slug,p_type='article' and coalesce(p_featured,false)) returning id into i;
 insert into public.content_revisions(item_id,revision_no,title,body,status,submitted_at,resolved_at) values(i,1,p_title,p_body,'approved',p_published_at,p_published_at) returning id into r;
 insert into public.revision_assets(revision_id,asset_id) select r,id from unnest(ids) id;
 insert into public.content_reviews(item_id,revision_id,status,decision_source,policy_snapshot,resolved_at,review_outcome) values(i,r,'approved','admin',jsonb_build_object('legacy_import',true,'source_sha256',p_source_sha256),p_published_at,'approved');
 insert into public.community_legacy_mappings(item_id,target_type,target_id,source_sha256,published_at) values(i,kind,p_target_id,p_source_sha256,p_published_at);
 perform public.community_record_first_publication(i,r);
 update public.content_items set published_revision_id=r where id=i;
 insert into public.community_management_audit(action,item_id,revision_id,details) values('legacy_import',i,r,jsonb_build_object('target_type',kind,'target_id',p_target_id,'source_sha256',p_source_sha256));
 return i;
end; $$;
-- Keep the existing exporter as the authority, add only protected management metadata.
alter function public.community_publication_export() rename to community_publication_export_base;
create function public.community_publication_export() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(v || jsonb_build_object('featured',i.featured) || case when m.item_id is not null then jsonb_build_object('legacy',jsonb_build_object('target_type',m.target_type,'target_id',m.target_id,'source_sha256',m.source_sha256,'published_at',m.published_at)) else '{}'::jsonb end order by i.id),'[]'::jsonb)
 from jsonb_array_elements(public.community_publication_export_base()) v join public.content_items i on i.id=(v->>'id')::uuid left join public.community_legacy_mappings m on m.item_id=i.id;
$$;
revoke all on function public.community_can_read_asset(uuid),public.community_import_legacy(uuid,text,text,text,text,text,jsonb,timestamptz,boolean),public.community_publication_export(),public.community_publication_export_base() from public,anon,authenticated;
grant execute on function public.community_can_read_asset(uuid) to authenticated;
grant execute on function public.community_import_legacy(uuid,text,text,text,text,text,jsonb,timestamptz,boolean),public.community_publication_export() to service_role;
alter function public.community_public_target(text,text) rename to community_public_target_base;
create function public.community_public_target(p_type text,p_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_type='content' and m.item_id is not null then v || jsonb_build_object(
 'target_type',m.target_type,'target_id',m.target_id,'published_at',m.published_at,
 'target_path',case m.target_type when 'post' then 'posts/'||m.target_id||'.html' when 'moment' then 'moments.html#moment-'||m.target_id else 'gallery.html?album='||m.target_id end)
 else v end from (select public.community_public_target_base(p_type,p_id) v) q
 left join public.community_legacy_mappings m on p_type='content' and m.item_id::text=p_id;
$$;
revoke all on function public.community_public_target(text,text),public.community_public_target_base(text,text) from public,anon,authenticated;
create function public.community_register_legacy_asset(p_owner uuid,p_path text,p_name text,p_mime text,p_size bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; asset_id uuid;
begin
 if p_owner is null or p_owner is distinct from (select legacy_author_id from public.community_publication_config where singleton) or split_part(p_path,'/',1)<>p_owner::text then raise exception 'Configured legacy owner required' using errcode='42501';end if;
 select * into obj from storage.objects where bucket_id='community-assets' and name=p_path for share;
 if obj.id is null or obj.metadata->>'mimetype' is distinct from p_mime or (obj.metadata->>'size')::bigint is distinct from p_size or p_size not between 1 and 94371840 or p_mime not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf','text/plain') or p_name is null or char_length(p_name) not between 1 and 255 or p_name ~ '[/\\[:cntrl:]]' then raise exception 'Invalid legacy asset metadata' using errcode='22023';end if;
 select id into asset_id from public.user_assets where storage_object_id=obj.id;
 if found then return asset_id;end if;
 insert into public.user_assets(owner_id,object_path,original_name,mime_type,size_bytes,storage_object_id) values(p_owner,p_path,p_name,p_mime,p_size,obj.id) returning id into asset_id;
 return asset_id;
end;$$;
revoke all on function public.community_register_legacy_asset(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.community_register_legacy_asset(uuid,text,text,text,bigint) to service_role;
commit;
