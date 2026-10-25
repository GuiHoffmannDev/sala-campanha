-- Agent inbox: executors claim queued user messages, one at a time per piece.
-- Only the service role (the executor, Plan 2) may call these functions.
--
-- Executor flow for one piece:
--   1. claim_next_message: takes the piece's oldest queued message.
--   2. absorb_pending (during the generation): takes the messages queued since
--      then, so redirections are folded into the running work and no other
--      executor answers them again.
--   3. touch_claim (periodically): keeps long generations from being
--      requeued by release_stale_claims.
--   4. complete_message for every claimed message. The piece accepts a new
--      claim only once none of its messages is claimed.

-- Inbox scans touch only open messages.
create index session_events_open_idx on public.session_events (piece_id, id)
  where delivery in ('queued', 'claimed');

-- Claims the oldest queued message whose piece has no claimed message.
-- Returns 0 or 1 row.
create function public.claim_next_message(p_executor text)
returns setof public.session_events
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_executor is null or btrim(p_executor) = '' then
    raise exception 'executor must not be empty' using errcode = '22023';
  end if;

  -- Only the piece's oldest open message is a candidate. With `skip locked`,
  -- a concurrent claimer that skips a locked message cannot fall through to
  -- the next message of the same piece: it is not the oldest open one.
  select e.id into v_id
  from public.session_events e
  where e.delivery = 'queued'
    and not exists (
      select 1 from public.session_events o
      where o.piece_id = e.piece_id
        and o.delivery in ('queued', 'claimed')
        and (o.delivery = 'claimed' or o.id < e.id)
    )
  order by e.id
  limit 1
  for update skip locked;

  if v_id is null then
    return;
  end if;

  return query
    update public.session_events
    set delivery = 'claimed', claimed_by = p_executor, claimed_at = now()
    where id = v_id
    returning *;
end
$$;

-- Claims every queued message of a piece for an executor that already holds
-- a claim on it, and returns them in conversation order. Used to fold
-- redirections into a running generation without another executor taking them.
create function public.absorb_pending(p_piece uuid, p_executor text)
returns setof public.session_events
language plpgsql
set search_path = ''
as $$
begin
  -- Lock the executor's claims: release_stale_claims cannot requeue them
  -- between this check and the absorb below, so the piece never ends up
  -- split between two executors.
  perform 1 from public.session_events e
  where e.piece_id = p_piece and e.delivery = 'claimed' and e.claimed_by = p_executor
  for update;
  if not found then
    raise exception 'executor holds no claim on this piece' using errcode = '42501';
  end if;

  -- Renew the claims it already holds, so all of them age together and a
  -- stale original message cannot be requeued while its redirections stay claimed.
  update public.session_events
  set claimed_at = now()
  where piece_id = p_piece and delivery = 'claimed' and claimed_by = p_executor;

  return query
    with picked as (
      select e.id from public.session_events e
      where e.piece_id = p_piece and e.delivery = 'queued'
      order by e.id
      for update
    )
    , absorbed as (
      update public.session_events e
      set delivery = 'claimed', claimed_by = p_executor, claimed_at = now()
      from picked
      where e.id = picked.id
      returning e.*
    )
    select * from absorbed order by id;
end
$$;

-- Renews every claim an executor holds on a piece, so a long generation is not
-- requeued by release_stale_claims. Returns how many claims were renewed.
create function public.touch_claim(p_piece uuid, p_executor text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.session_events
  set claimed_at = now()
  where piece_id = p_piece and delivery = 'claimed' and claimed_by = p_executor;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'executor holds no claim on this piece' using errcode = '42501';
  end if;
  return v_count;
end
$$;

-- Closes a claimed message as `done` or `failed`; only its claimer may do it.
create function public.complete_message(p_event bigint, p_executor text, p_status public.delivery_status)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('done', 'failed') then
    raise exception 'status must be done or failed' using errcode = '22023';
  end if;

  update public.session_events
  set delivery = p_status
  where id = p_event and delivery = 'claimed' and claimed_by = p_executor;

  if not found then
    raise exception 'message is not claimed by this executor' using errcode = '42501';
  end if;
end
$$;

-- Requeues claims older than `p_older_than` (an executor that died mid-task).
-- Returns how many messages went back to the queue.
create function public.release_stale_claims(p_older_than interval)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_older_than is null or p_older_than < interval '0' then
    raise exception 'interval must be zero or positive' using errcode = '22023';
  end if;

  update public.session_events
  set delivery = 'queued', claimed_by = null, claimed_at = null
  where delivery = 'claimed' and claimed_at <= now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.claim_next_message(text) from public, anon, authenticated;
revoke all on function public.absorb_pending(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_message(bigint, text, public.delivery_status) from public, anon, authenticated;
revoke all on function public.release_stale_claims(interval) from public, anon, authenticated;
revoke all on function public.touch_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_next_message(text) to service_role;
grant execute on function public.absorb_pending(uuid, text) to service_role;
grant execute on function public.complete_message(bigint, text, public.delivery_status) to service_role;
grant execute on function public.release_stale_claims(interval) to service_role;
grant execute on function public.touch_claim(uuid, text) to service_role;
