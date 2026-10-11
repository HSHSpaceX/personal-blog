-- Public display projections, never raw Auth/reaction records. No legacy owner is fabricated.
begin;
create table public.legacy_public_targets (
  target_type text not null check(target_type in ('post','moment','album')),
  target_id text not null check(char_length(target_id) between 1 and 160),
  title text not null, excerpt text not null, target_path text not null,
  published_at timestamptz not null, primary key(target_type,target_id)
);
alter table public.legacy_public_targets enable row level security;
revoke all on public.legacy_public_targets from public,anon,authenticated;
-- Trusted snapshot of current public static targets. Unknown targets fail closed
-- in public activity projections; legacy like insertion remains compatible.
insert into public.legacy_public_targets values
 ('post','about','关于我','拾光手记','about.html#commentsSection','2026-09-27'),
 ('post','post-austria-history','奥匈帝国的兴衰：一个多民族帝国的百年孤独','从1867年二元君主制建立，到1918年解体，奥匈帝国用半个世纪演绎了一个多民族国家的理想与困境。','posts/post-austria-history.html#commentsSection','2026-09-20'),
 ('moment','m20260930-153407-jq9o','星舰14飞','星舰14飞，还是比较成功的！','moments.html#moment-m20260930-153407-jq9o','2026-09-30 15:34+00'),
 ('moment','m20260914-204633-fp3i','纪念吴老师','吴老师的去世实在是太突然了……','moments.html#moment-m20260914-204633-fp3i','2026-09-14 20:46+00');

create function public.community_check_page(p_limit integer,p_offset integer) returns void
language plpgsql immutable set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 100000 then
   raise exception 'Invalid page' using errcode='22023'; end if;
end; $$;
revoke all on function public.community_check_page(integer,integer) from public,anon,authenticated;
create function public.profile_followers(p_user_id uuid,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,username text,display_name text,avatar_url text,bio text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.community_check_page(p_limit,p_offset);
 return query select p.id,p.username,p.display_name,p.avatar_url,p.bio from public.follows f
 join public.profiles p on p.id=f.follower_id where f.target_id=p_user_id
 order by f.created_at desc,p.id limit p_limit offset p_offset;
end; $$;
create function public.profile_following(p_user_id uuid,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,username text,display_name text,avatar_url text,bio text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.community_check_page(p_limit,p_offset);
 return query select p.id,p.username,p.display_name,p.avatar_url,p.bio from public.follows f
 join public.profiles p on p.id=f.target_id where f.follower_id=p_user_id
 order by f.created_at desc,p.id limit p_limit offset p_offset;
end; $$;
create function public.following_count(p_user_id uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select count(*) from public.follows where follower_id=p_user_id;
$$;
-- One allowlisted target resolver shared by likes and approved-comment context.
create function public.community_public_target(p_type text,p_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_type='content' then (
   select jsonb_build_object('kind',i.content_type,'target_type','content','target_id',i.id::text,
     'revision_id',r.id,'title',r.title,'text',coalesce(r.body->>'text',r.body->>'description',''),
     'body',r.body,'published_at',r.resolved_at,'username',p.username,'display_name',p.display_name,
     'avatar_url',p.avatar_url,'target_path','profile.html?username='||p.username||'&item='||i.id::text)
   from public.content_items i join public.content_revisions r on r.id=i.published_revision_id and r.status='approved'
   join public.profiles p on p.id=i.author_id where i.id::text=p_id
 ) else (
   select jsonb_build_object('kind',case t.target_type when 'post' then 'article' else t.target_type end,
     'target_type',t.target_type,'target_id',t.target_id,'title',t.title,'text',t.excerpt,'target_path',t.target_path,
     'published_at',t.published_at,'username','hshspacex','display_name','HSH(站长)','avatar_url','assets/icon.jpg','legacy',true)
   from public.legacy_public_targets t where t.target_type=p_type and t.target_id=p_id
 ) end;
$$;
create function public.community_comment_context(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_slug like 'moment-%' then public.community_public_target('moment',substr(p_slug,8))
   when p_slug like 'album-%' then public.community_public_target('album',substr(p_slug,7))
   when p_slug like 'community-%' then public.community_public_target('content',substr(p_slug,11))
   else public.community_public_target('post',p_slug) end;
$$;
create function public.profile_content(p_user_id uuid,p_type text,p_limit integer default 20,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.community_check_page(p_limit,p_offset);
 if p_type is null or p_type not in ('article','moment','album','comment') then raise exception 'Invalid content type' using errcode='22023'; end if;
 if p_type='comment' then
   return query select jsonb_build_object('kind','comment','target_type','comment','target_id',c.id::text,
     'title',case when c.parent_id is null then '评论' else '回复' end,'text',c.content,'published_at',c.created_at,
     'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,
     'context',public.community_comment_context(c.post_slug),
     'parent_text',(select pc.content from public.comments pc where pc.id=c.parent_id and pc.status='approved'),
     'target_path',public.community_comment_context(c.post_slug)->>'target_path')
   from public.comments c join public.profiles p on p.id=c.user_id
   where c.user_id=p_user_id and c.status='approved' and public.community_comment_context(c.post_slug) is not null
   order by c.created_at desc,c.id limit p_limit offset p_offset;
 else
   return query select public.community_public_target('content',i.id::text)
   from public.content_items i join public.content_revisions r on r.id=i.published_revision_id and r.status='approved'
   where i.author_id=p_user_id and i.content_type=p_type order by r.resolved_at desc,i.id limit p_limit offset p_offset;
 end if;
end; $$;
create function public.profile_recent_likes(p_user_id uuid,p_limit integer default 20,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.community_check_page(p_limit,p_offset);
 return query select q.card||jsonb_build_object('liked_at',q.liked_at) from (
   select l.created_at as liked_at,l.target_type,l.target_id,
   case when l.target_type='comment' then (
     select jsonb_build_object('kind','comment','target_type','comment','target_id',c.id::text,
       'title',case when c.parent_id is null then '评论' else '回复' end,'text',c.content,'published_at',c.created_at,
       'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,
       'context',public.community_comment_context(c.post_slug),
       'parent_text',(select pc.content from public.comments pc where pc.id=c.parent_id and pc.status='approved'),
       'target_path',public.community_comment_context(c.post_slug)->>'target_path')
     from public.comments c left join public.profiles p on p.id=c.user_id
     where c.id::text=l.target_id and c.status='approved' and public.community_comment_context(c.post_slug) is not null
   ) else public.community_public_target(l.target_type,l.target_id) end as card
   from public.likes l where l.user_id=p_user_id
 ) q where q.card is not null order by q.liked_at desc,q.target_type,q.target_id limit p_limit offset p_offset;
end; $$;

alter table public.likes drop constraint likes_target_type_check;
alter table public.likes add constraint likes_target_type_check check(target_type in ('post','moment','comment','album','content'));
create function public.community_like_target_visible(p_type text,p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.community_public_target(p_type,p_id) is not null;
$$;
revoke all on function public.community_like_target_visible(text,text) from public,anon,authenticated;
grant execute on function public.community_like_target_visible(text,text) to authenticated;
drop policy likes_insert_self on public.likes;
create policy likes_insert_self on public.likes for insert to authenticated
 with check(user_id=(select auth.uid()) and (
   target_type in ('post','moment') or
   (target_type='comment' and exists(select 1 from public.comments c where c.id::text=target_id and c.status='approved')) or
   (target_type in ('album','content') and public.community_like_target_visible(target_type,target_id))
 ));
create or replace function public.like_counts(p_target_type text,p_target_ids text[])
returns table(target_id text,like_count bigint) language plpgsql stable security definer set search_path='' as $$
begin
 if p_target_type is null or p_target_type not in ('post','moment','comment','album','content') or
 p_target_ids is null or cardinality(p_target_ids)>100 or coalesce(array_ndims(p_target_ids),1)<>1 or
 exists(select 1 from unnest(p_target_ids) v(id) where v.id is null or char_length(v.id) not between 1 and 160) then
 raise exception 'Invalid like count request' using errcode='22023'; end if;
 return query select l.target_id,count(*) from public.likes l where l.target_type=p_target_type and l.target_id=any(p_target_ids)
 and (p_target_type in ('post','moment','comment') or public.community_like_target_visible(p_target_type,l.target_id)) group by l.target_id;
end; $$;
revoke all on function public.community_public_target(text,text),public.community_comment_context(text) from public,anon,authenticated;
revoke all on function public.profile_followers(uuid,integer,integer),public.profile_following(uuid,integer,integer),
 public.following_count(uuid),public.profile_content(uuid,text,integer,integer),public.profile_recent_likes(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.profile_followers(uuid,integer,integer),public.profile_following(uuid,integer,integer),
 public.following_count(uuid),public.profile_content(uuid,text,integer,integer),public.profile_recent_likes(uuid,integer,integer) to anon,authenticated;
commit;
