-- Piece versions, the piece status machine and approvals.
-- Versions, status and approval change only through the RPCs below; every
-- change is also written to the piece conversation as an event.

create table public.piece_versions (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null,
  team_id uuid not null,
  number int not null,
  origin text not null check (origin in ('agente', 'upload')),
  phase text not null check (phase in ('base', 'final')),
  image_path text null check (image_path like team_id::text || '/%'),
  caption text null,
  -- Null for agent versions, or once the author's account is deleted.
  author_id uuid null references auth.users (id) on delete set null,
  source_event_id bigint null references public.session_events (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (piece_id, number),
  -- Target of the composite FK from pieces.approved_version_id.
  unique (id, piece_id),
  -- A version is a package: image and/or caption, never neither.
  check (image_path is not null or caption is not null),
  foreign key (piece_id, team_id) references public.pieces (id, team_id) on delete cascade
);

create index piece_versions_team_id_idx on public.piece_versions (team_id);
create index piece_versions_source_event_id_idx on public.piece_versions (source_event_id);

-- The approved version must belong to the same piece.
alter table public.pieces
  add foreign key (approved_version_id, id) references public.piece_versions (id, piece_id);

-- Grants: members read; every write goes through RPCs or the service role.
revoke all on public.piece_versions from anon, authenticated;
grant select on public.piece_versions to authenticated;
grant all on public.piece_versions to service_role;

alter table public.piece_versions enable row level security;

create policy piece_versions_select_members on public.piece_versions
  for select to authenticated
  using (private.team_role_of(team_id) is not null);

-- Event helper shared by the RPCs: not delivered to the agent.
create function private.add_event(p_piece public.pieces, p_kind public.event_kind, p_body jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.session_events (piece_id, team_id, author_id, kind, body, to_agent, delivery)
  values (p_piece.id, p_piece.team_id, auth.uid(), p_kind, p_body, false, 'not_applicable')
$$;

-- Adds the next version of a piece. The caller must hold `for update` on the
-- piece row, which serializes the max + 1 numbering.
create function private.add_version(
  p_piece public.pieces, p_origin text, p_phase text, p_image_path text, p_caption text, p_source_event bigint
)
returns public.piece_versions
language plpgsql
set search_path = ''
as $$
declare
  v_version public.piece_versions;
begin
  insert into public.piece_versions (piece_id, team_id, number, origin, phase, image_path, caption, author_id, source_event_id)
  values (
    p_piece.id, p_piece.team_id,
    coalesce((select max(v.number) from public.piece_versions v where v.piece_id = p_piece.id), 0) + 1,
    p_origin, p_phase, p_image_path, p_caption, auth.uid(), p_source_event
  )
  returning * into v_version;

  perform private.add_event(p_piece, 'version_added',
    jsonb_build_object('version_id', v_version.id, 'number', v_version.number, 'phase', v_version.phase));
  return v_version;
end
$$;

-- Moves a piece to a new status and records `status_changed` with {from, to}.
create function private.set_status(p_piece public.pieces, p_to public.piece_status)
returns public.pieces
language plpgsql
set search_path = ''
as $$
declare
  v_piece public.pieces;
begin
  update public.pieces set status = p_to where id = p_piece.id returning * into v_piece;
  perform private.add_event(p_piece, 'status_changed', jsonb_build_object('from', p_piece.status, 'to', p_to));
  return v_piece;
end
$$;

revoke all on function private.add_event(public.pieces, public.event_kind, jsonb) from public;
revoke all on function private.add_version(public.pieces, text, text, text, text, bigint) from public;
revoke all on function private.set_status(public.pieces, public.piece_status) from public;
-- add_agent_version runs as the service role (security invoker) and calls these.
grant execute on function private.add_event(public.pieces, public.event_kind, jsonb) to service_role;
grant execute on function private.add_version(public.pieces, text, text, text, text, bigint) to service_role;
grant execute on function private.set_status(public.pieces, public.piece_status) to service_role;

-- Locks a piece the caller may write. Same error for a missing piece and
-- another team's piece: no existence leak.
create function private.lock_writable_piece(p_piece uuid)
returns public.pieces
language plpgsql
set search_path = ''
as $$
declare
  v_piece public.pieces;
begin
  select * into v_piece from public.pieces where id = p_piece for update;
  if not found or not private.can_write(v_piece.team_id) then
    raise exception 'piece not found or not writable' using errcode = '42501';
  end if;
  return v_piece;
end
$$;

revoke all on function private.lock_writable_piece(uuid) from public;

-- Executor only (Plan 2): stores an agent result as a base version.
create function public.add_agent_version(p_piece uuid, p_image_path text, p_caption text, p_source_event bigint)
returns public.piece_versions
language plpgsql
set search_path = ''
as $$
declare
  v_piece public.pieces;
  v_version public.piece_versions;
begin
  select * into v_piece from public.pieces where id = p_piece for update;
  if not found then
    raise exception 'piece not found' using errcode = '22023';
  end if;

  if p_source_event is not null and not exists (
    select 1 from public.session_events e where e.id = p_source_event and e.piece_id = v_piece.id
  ) then
    raise exception 'source event must belong to the piece' using errcode = '22023';
  end if;

  v_version := private.add_version(v_piece, 'agente', 'base', p_image_path, p_caption, p_source_event);
  if v_piece.status = 'gerando' then
    perform private.set_status(v_piece, 'base_em_revisao');
  end if;
  return v_version;
end
$$;

-- A member uploads the final version made outside the app (Photoshop).
create function public.upload_final_version(p_piece uuid, p_image_path text, p_caption text)
returns public.piece_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_piece public.pieces := private.lock_writable_piece(p_piece);
  v_version public.piece_versions;
begin
  if v_piece.status not in ('acabamento', 'final_em_revisao') then
    raise exception 'final version needs status acabamento or final_em_revisao' using errcode = '22023';
  end if;

  v_version := private.add_version(v_piece, 'upload', 'final', p_image_path, p_caption, null);
  if v_piece.status = 'acabamento' then
    perform private.set_status(v_piece, 'final_em_revisao');
  end if;
  return v_version;
end
$$;

-- Edits a caption by adding a new version with the same image (a version is a package).
create function public.update_caption(p_version uuid, p_caption text)
returns public.piece_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.piece_versions;
  v_piece public.pieces;
begin
  select * into v_source from public.piece_versions where id = p_version;
  if not found then
    raise exception 'piece not found or not writable' using errcode = '42501';
  end if;
  v_piece := private.lock_writable_piece(v_source.piece_id);

  if p_caption is null or p_caption !~ '\S' then
    raise exception 'caption must not be empty' using errcode = '22023';
  end if;
  if v_piece.approved_version_id = v_source.id then
    raise exception 'approved version cannot be edited' using errcode = '22023';
  end if;

  return private.add_version(v_piece, v_source.origin, v_source.phase, v_source.image_path, p_caption, null);
end
$$;

-- Approves a version of the given piece:
--   base_em_revisao + base  -> acabamento (texto pieces skip to aprovada)
--   final_em_revisao + final -> aprovada
create function public.approve_version(p_piece uuid, p_version uuid)
returns public.pieces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_piece public.pieces;
  v_version public.piece_versions;
  v_to public.piece_status;
begin
  select * into v_piece from public.pieces where id = p_piece for update;
  if not found or not private.can_approve(v_piece.team_id) then
    raise exception 'piece not found or not approvable' using errcode = '42501';
  end if;

  select * into v_version from public.piece_versions where id = p_version and piece_id = v_piece.id;
  if not found then
    raise exception 'version does not belong to the piece' using errcode = '22023';
  end if;

  v_to := case
    when v_piece.status = 'base_em_revisao' and v_version.phase = 'base'
      then case when v_piece.kind = 'texto' then 'aprovada' else 'acabamento' end
    when v_piece.status = 'final_em_revisao' and v_version.phase = 'final' then 'aprovada'
  end::public.piece_status;
  if v_to is null then
    raise exception 'version % cannot be approved in status %', v_version.phase, v_piece.status using errcode = '22023';
  end if;

  perform private.add_event(v_piece, 'approval',
    jsonb_build_object('version_id', v_version.id, 'from', v_piece.status, 'to', v_to));
  update public.pieces set status = v_to, approved_version_id = v_version.id
  where id = v_piece.id returning * into v_piece;
  return v_piece;
end
$$;

-- Moves a piece one status back. Keeps approved_version_id: it records the
-- last approval; a new approval replaces it.
create function public.step_back(p_piece uuid)
returns public.pieces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_piece public.pieces := private.lock_writable_piece(p_piece);
  v_statuses public.piece_status[] := enum_range(null::public.piece_status);
  v_pos int := array_position(v_statuses, v_piece.status);
begin
  if v_pos = 1 then
    raise exception 'no previous status' using errcode = '22023';
  end if;
  return private.set_status(v_piece, v_statuses[v_pos - 1]);
end
$$;

revoke all on function public.add_agent_version(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.add_agent_version(uuid, text, text, bigint) to service_role;

revoke all on function public.upload_final_version(uuid, text, text) from public, anon;
revoke all on function public.update_caption(uuid, text) from public, anon;
revoke all on function public.approve_version(uuid, uuid) from public, anon;
revoke all on function public.step_back(uuid) from public, anon;
grant execute on function public.upload_final_version(uuid, text, text) to authenticated;
grant execute on function public.update_caption(uuid, text) to authenticated;
grant execute on function public.approve_version(uuid, uuid) to authenticated;
grant execute on function public.step_back(uuid) to authenticated;
