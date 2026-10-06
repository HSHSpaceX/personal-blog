begin;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check(type in ('comment_approved','comment_reply','comment_like','follow','content_approved','content_rejected'));
alter table public.notifications add column revision_id uuid references public.content_revisions(id) on delete cascade;
-- Reasons can be up to 2000 chars; preserve the FULL reason in the notification.
alter table public.notifications drop constraint notifications_body_check;
alter table public.notifications add constraint notifications_body_check check(char_length(body)<=2000);
create unique index notifications_content_decision on public.notifications(revision_id)
  where type in ('content_approved','content_rejected');
create function public.community_notify_review_result() returns trigger language plpgsql security definer set search_path='' as $$
declare author uuid;
begin
  if old.status='pending' and new.status in ('approved','rejected') and new.decision_source='admin' then
    select author_id into author from public.content_items where id=new.item_id;
    if author is not null and author is distinct from new.reviewer_id then
      insert into public.notifications(user_id,actor_id,type,title,body,revision_id)
        values(author,new.reviewer_id,'content_'||new.status,
          case when new.status='approved' then '内容审核通过' else '内容被驳回，请重新编辑' end,
          coalesce(new.rejection_reason,''),new.revision_id);
    end if;
  end if;
  return new;
end;
$$;
create trigger community_review_result after update of status on public.content_reviews
  for each row execute function public.community_notify_review_result();
revoke all on function public.community_notify_review_result() from public,anon,authenticated;
commit;
