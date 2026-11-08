begin;
-- Expose the current published revision's approval time as updated_at so the
-- public site can show the latest edit date. published_at keeps meaning the
-- first approval (unchanged); updated_at is the most recent approved revision.
create or replace function public.community_publication_export() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(v || jsonb_build_object('featured',i.featured,
   'published_at',coalesce(m.published_at,f.approved_at,(v->>'published_at')::timestamptz),
   'updated_at',(v->>'published_at')::timestamptz)
   || case when m.item_id is not null then jsonb_build_object('legacy',jsonb_build_object('target_type',m.target_type,'target_id',m.target_id,'source_sha256',m.source_sha256,'published_at',m.published_at)) else '{}'::jsonb end order by i.id),'[]'::jsonb)
 from jsonb_array_elements(public.community_publication_export_base()) v join public.content_items i on i.id=(v->>'id')::uuid
 left join public.community_legacy_mappings m on m.item_id=i.id left join public.content_first_publications f on f.item_id=i.id;
$$;
revoke all on function public.community_publication_export() from public,anon,authenticated;
grant execute on function public.community_publication_export() to service_role;
commit;
