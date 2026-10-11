begin;
create table public.dm_client_requests (
 sender_id uuid not null references auth.users(id) on delete cascade, nonce uuid not null,
 thread_id uuid not null references public.dm_threads(id) on delete cascade,
 payload_hash text not null, message_id uuid references public.dm_messages(id) on delete cascade,
 primary key(sender_id,nonce)
);
alter table public.dm_client_requests enable row level security;
revoke all on public.dm_client_requests from public,anon,authenticated;
create function public.dm_send_message_once(p_thread_id uuid,p_body text,p_asset_ids uuid[],p_client_nonce uuid,p_expected_sender_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.dm_client_requests; mid uuid; fingerprint text;
begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_sender_id or p_client_nonce is null then raise exception 'Thread unavailable; account changed' using errcode='42501';end if;
 if p_body is null or p_asset_ids is null then raise exception 'Invalid message' using errcode='22023';end if;
 fingerprint:=md5(jsonb_build_array(p_thread_id,p_body,p_asset_ids)::text);
 insert into public.dm_client_requests(sender_id,nonce,thread_id,payload_hash) values(auth.uid(),p_client_nonce,p_thread_id,fingerprint) on conflict do nothing;
 select * into strict request from public.dm_client_requests where sender_id=auth.uid() and nonce=p_client_nonce for update;
 if request.thread_id<>p_thread_id or request.payload_hash<>fingerprint then raise exception 'Message retry payload changed' using errcode='22023';end if;
 if request.message_id is not null then return request.message_id;end if;
 mid:=public.dm_send_message(p_thread_id,p_body,p_asset_ids,p_expected_sender_id);
 update public.dm_client_requests set message_id=mid where sender_id=auth.uid() and nonce=p_client_nonce;
 return mid;
end; $$;
revoke all on function public.dm_send_message_once(uuid,text,uuid[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.dm_send_message_once(uuid,text,uuid[],uuid,uuid) to authenticated;
commit;
