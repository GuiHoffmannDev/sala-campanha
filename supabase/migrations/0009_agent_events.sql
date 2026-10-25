-- Agent events in the piece conversation: agent_started, agent_result and
-- agent_error. Only the service role (the executor, Plan 2) may write them,
-- and only while it still holds the claim on the source message, so an
-- executor whose claim was released by release_stale_claims cannot post
-- results next to the executor that took the message over.

create function public.add_agent_event(
  p_source_event bigint, p_executor text, p_kind public.event_kind, p_body jsonb
)
returns public.session_events
language plpgsql
set search_path = ''
as $$
declare
  v_source public.session_events;
  v_event public.session_events;
begin
  if p_kind is null or p_kind not in ('agent_started', 'agent_result', 'agent_error') then
    raise exception 'kind must be agent_started, agent_result or agent_error' using errcode = '22023';
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'body must be a JSON object' using errcode = '22023';
  end if;

  -- Lock the message so release_stale_claims cannot requeue it mid-call.
  select * into v_source from public.session_events e
  where e.id = p_source_event and e.delivery = 'claimed' and e.claimed_by = p_executor
  for update;
  if not found then
    raise exception 'source message is not claimed by this executor' using errcode = '42501';
  end if;

  insert into public.session_events (piece_id, team_id, author_id, kind, body, to_agent, delivery)
  values (v_source.piece_id, v_source.team_id, null, p_kind, p_body, false, 'not_applicable')
  returning * into v_event;

  return v_event;
end
$$;

revoke all on function public.add_agent_event(bigint, text, public.event_kind, jsonb) from public, anon, authenticated;
grant execute on function public.add_agent_event(bigint, text, public.event_kind, jsonb) to service_role;
