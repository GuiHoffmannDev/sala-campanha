-- The piece conversation as an ordered list of events, and message routing.
-- Clients only read events; user messages enter through `post_message`.

create type public.event_kind as enum (
  'user_message', 'agent_started', 'agent_result', 'agent_error',
  'status_changed', 'version_added', 'approval'
);

create type public.delivery_status as enum (
  'queued', 'claimed', 'done', 'failed', 'not_applicable'
);

-- Target of the composite FK below: an event's team must be its piece's team.
alter table public.pieces add unique (id, team_id);

create table public.session_events (
  -- Increasing id is the conversation order; clients fetch `id > last seen`.
  id bigint generated always as identity primary key,
  piece_id uuid not null,
  team_id uuid not null,
  -- Null for agent/system events, or once the author's account is deleted.
  author_id uuid null references auth.users (id) on delete set null,
  kind public.event_kind not null,
  body jsonb not null,
  to_agent boolean not null,
  mention_user_ids uuid[] not null default '{}',
  delivery public.delivery_status not null,
  claimed_by text null,
  claimed_at timestamptz null,
  created_at timestamptz not null default now(),
  foreign key (piece_id, team_id) references public.pieces (id, team_id) on delete cascade
);

create index session_events_piece_id_idx on public.session_events (piece_id, id);
create index session_events_team_id_idx on public.session_events (team_id);

-- Grants: members read; every write goes through RPCs or the service role.
revoke all on public.session_events from anon, authenticated;
grant select on public.session_events to authenticated;
grant all on public.session_events to service_role;

alter table public.session_events enable row level security;

create policy session_events_select_members on public.session_events
  for select to authenticated
  using (private.team_role_of(team_id) is not null);

create function public.post_message(
  p_piece uuid,
  p_text text,
  p_mention_user_ids uuid[] default '{}',
  p_model jsonb default null,
  p_reference_asset_ids uuid[] default '{}'
)
returns public.session_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_piece public.pieces;
  v_mentions uuid[] := coalesce(p_mention_user_ids, '{}');
  v_refs uuid[] := coalesce(p_reference_asset_ids, '{}');
  v_to_agent boolean;
  v_event public.session_events;
begin
  select * into v_piece from public.pieces where id = p_piece;
  -- Same error for a missing piece and another team's piece: no existence leak.
  if not found or not private.can_write(v_piece.team_id) then
    raise exception 'piece not found or not writable' using errcode = '42501';
  end if;

  if p_text is null or p_text !~ '\S' then
    raise exception 'message text must not be empty' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_mentions) as m (user_id)
    where not exists (
      select 1 from public.team_members tm
      where tm.team_id = v_piece.team_id and tm.user_id = m.user_id
    )
  ) then
    raise exception 'mentioned users must belong to the piece team' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_refs) as r (asset_id)
    where not exists (
      select 1 from public.reference_assets ra
      where ra.id = r.asset_id and ra.campaign_id = v_piece.campaign_id and ra.team_id = v_piece.team_id
    )
  ) then
    raise exception 'reference assets must belong to the piece campaign' using errcode = '22023';
  end if;

  -- People-only conversation: starts with `@` and names at least one person.
  v_to_agent := not (left(ltrim(p_text, E' \t\r\n'), 1) = '@' and cardinality(v_mentions) > 0);

  insert into public.session_events (piece_id, team_id, author_id, kind, body, to_agent, mention_user_ids, delivery)
  values (
    v_piece.id, v_piece.team_id, auth.uid(), 'user_message',
    jsonb_build_object('text', p_text, 'model', p_model, 'reference_asset_ids', to_jsonb(v_refs)),
    v_to_agent, v_mentions,
    case when v_to_agent then 'queued'::public.delivery_status else 'not_applicable'::public.delivery_status end
  )
  returning * into v_event;

  return v_event;
end
$$;

revoke all on function public.post_message(uuid, text, uuid[], jsonb, uuid[]) from public, anon;
grant execute on function public.post_message(uuid, text, uuid[], jsonb, uuid[]) to authenticated;
