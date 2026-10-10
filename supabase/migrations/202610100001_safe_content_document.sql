-- Forward-only safe rich content. Existing revisions, policies and publication RPCs unchanged.
begin;
create function public.community_validate_inline(p_runs jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare r jsonb; m jsonb; result text:=''; href text;
begin
 if jsonb_typeof(p_runs) is distinct from 'array' or jsonb_array_length(p_runs)>1000 then raise exception 'Invalid inline content' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_runs) loop
  if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('text','marks','href')) or jsonb_typeof(r->'text') is distinct from 'string' or char_length(r->>'text')>100000 then raise exception 'Invalid inline fields' using errcode='22023'; end if;
  if r ? 'marks' then
   if jsonb_typeof(r->'marks') is distinct from 'array' or jsonb_array_length(r->'marks')>2 then raise exception 'Invalid marks' using errcode='22023'; end if;
   for m in select value from jsonb_array_elements(r->'marks') loop
    if jsonb_typeof(m) is distinct from 'string' or m#>>'{}' not in ('bold','italic') then raise exception 'Invalid mark' using errcode='22023'; end if;
   end loop;
   if jsonb_array_length(r->'marks')<>(select count(distinct value) from jsonb_array_elements(r->'marks')) then raise exception 'Duplicate mark' using errcode='22023'; end if;
  end if;
  if r ? 'href' then
   href:=r->>'href';
   if jsonb_typeof(r->'href') is distinct from 'string' or char_length(href)>2048 or href ~ '[[:space:]<>"''\\[:cntrl:]]' or not (href ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' or href ~ '^mailto:[^?@]+@[A-Za-z0-9.-]+$') then raise exception 'Unsafe link' using errcode='22023'; end if;
   if href ~ '^https?://' and coalesce(substring(href from '^https?://[A-Za-z0-9.-]+:([0-9]{1,5})'), '80')::integer>65535 then raise exception 'Unsafe link port' using errcode='22023'; end if;
  end if;
  result:=result||(r->>'text');
 end loop;
 return result;
end; $$;
revoke all on function public.community_validate_inline(jsonb) from public,anon,authenticated;
create function public.community_validate_document(p_document jsonb,p_ids uuid[],p_max integer,p_text text) returns void
language plpgsql immutable set search_path='' as $$
declare b jsonb; v jsonb; text_blocks text[]:='{}'; list_text text[]; txt text; kind text;
begin
 if jsonb_typeof(p_document) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_document) k where k not in ('version','blocks')) or p_document->'version' is distinct from '1'::jsonb or jsonb_typeof(p_document->'blocks') is distinct from 'array' or jsonb_array_length(p_document->'blocks')>200 then raise exception 'Invalid document' using errcode='22023'; end if;
 for b in select value from jsonb_array_elements(p_document->'blocks') loop
  if jsonb_typeof(b) is distinct from 'object' then raise exception 'Invalid block' using errcode='22023'; end if;
  kind:=b->>'type';
  if kind='asset' then
   if exists(select 1 from jsonb_object_keys(b) k where k not in ('type','asset_id')) or jsonb_typeof(b->'asset_id') is distinct from 'string' or not (coalesce(b->>'asset_id','') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') or not (lower(b->>'asset_id')=any(p_ids::text[])) then raise exception 'Invalid document asset' using errcode='22023'; end if;
  elsif kind='list' then
   if exists(select 1 from jsonb_object_keys(b) k where k not in ('type','ordered','items')) or jsonb_typeof(b->'ordered') is distinct from 'boolean' or jsonb_typeof(b->'items') is distinct from 'array' or jsonb_array_length(b->'items') not between 1 and 100 then raise exception 'Invalid list' using errcode='22023'; end if;
   list_text:='{}'; for v in select value from jsonb_array_elements(b->'items') loop list_text:=array_append(list_text,public.community_validate_inline(v)); end loop;
   text_blocks:=array_append(text_blocks,array_to_string(list_text,E'\n'));
  elsif kind in ('paragraph','heading','quote','code') then
   if exists(select 1 from jsonb_object_keys(b) k where not(k=any(case when kind='heading' then array['type','level','runs'] else array['type','runs'] end))) or (kind='heading' and (b->'level' is distinct from '2'::jsonb and b->'level' is distinct from '3'::jsonb)) then raise exception 'Invalid text block' using errcode='22023'; end if;
   text_blocks:=array_append(text_blocks,public.community_validate_inline(b->'runs'));
  else raise exception 'Unknown document block' using errcode='22023'; end if;
 end loop;
 txt:=coalesce(array_to_string(text_blocks,E'\n\n'),'');
 if char_length(txt)>p_max or txt is distinct from p_text then raise exception 'Document text mismatch' using errcode='22023'; end if;
end; $$;
revoke all on function public.community_validate_document(jsonb,uuid[],integer,text) from public,anon,authenticated;
create or replace function public.community_validate_body(p_type text,p_body jsonb) returns uuid[]
language plpgsql immutable set search_path='' as $$
declare allowed text[]; v jsonb; entry jsonb; ids uuid[] := '{}'; asset uuid;
begin
  if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>1048576 then
    raise exception 'Invalid content schema' using errcode='22023'; end if;
  allowed := case p_type when 'article' then array['text','summary','tags','asset_ids','category','document','cover_asset_id']
    when 'moment' then array['text','asset_ids','document'] when 'album' then array['description','photos','document'] end;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_body) k where not(k=any(allowed))) then
    raise exception 'Invalid content fields' using errcode='22023'; end if;
  if p_body ? 'category' and (jsonb_typeof(p_body->'category')<>'string' or char_length(p_body->>'category')>40 or char_length(btrim(p_body->>'category'))<1 or (p_body->>'category') ~ '[<>]') then
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
  if p_body ? 'cover_asset_id' and (jsonb_typeof(p_body->'cover_asset_id') is distinct from 'string' or not ((p_body->>'cover_asset_id') = any(ids::text[]))) then
    raise exception 'Invalid cover asset' using errcode='22023'; end if;
  if p_body ? 'document' then
    perform public.community_validate_document(p_body->'document', ids,
      case when p_type='article' then 100000 else 2000 end,
      case when p_type='album' then coalesce(p_body->>'description','') else p_body->>'text' end);
  end if;
  return ids;
end;
$$;
revoke all on function public.community_validate_body(text,jsonb) from public,anon,authenticated;


-- Cover selection is a controlled image reference, checked independently of the GUI.
create function public.community_check_document_cover() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.body ? 'cover_asset_id' and not exists (
   select 1 from public.user_assets a join public.content_items i on i.id=new.item_id
   where a.id=(new.body->>'cover_asset_id')::uuid and a.owner_id=i.author_id
     and a.mime_type in ('image/jpeg','image/png','image/webp')) then
   raise exception 'Invalid cover image' using errcode='22023';
 end if;
 return new;
end; $$;
revoke all on function public.community_check_document_cover() from public,anon,authenticated;
create trigger community_document_cover before insert or update of status on public.content_revisions
for each row execute function public.community_check_document_cover();
commit;
