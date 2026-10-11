-- Keep raw category length aligned with client/publisher, including whitespace.
-- Separate forward migration: no previously committed migration is rewritten.
begin;
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
  return ids;
end;
$$;
revoke all on function public.community_validate_body(text,jsonb) from public,anon,authenticated;

commit;
