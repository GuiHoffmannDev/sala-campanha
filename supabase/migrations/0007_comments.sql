-- Comments on a piece version. A comment targets one of:
--   a point of the image: x and y relative to the image (0..1);
--   a caption excerpt: [text_start, text_end) in Unicode code points (not UTF-16
--   units; clients use Array.from(caption)), plus the quoted text;
--   nothing: a plain comment on the version.
-- Threads are one level deep: a reply points to a root comment and has no
-- target of its own. Every comment is also written to the piece conversation
-- as a `comment` event (not delivered to the agent).

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  piece_id uuid not null,
  team_id uuid not null,
  -- Null only once the author's account is deleted.
  author_id uuid null default auth.uid() references auth.users (id) on delete set null,
  body text not null check (body ~ '\S'),
  x real null,
  y real null,
  text_start int null,
  text_end int null,
  quote text null,
  parent_id uuid null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  -- Exactly one target kind. Columns are tested for not null explicitly: a
  -- check that evaluates to null would pass.
  check (
    (x is null and y is null and text_start is null and text_end is null and quote is null)
    or (x is not null and y is not null and x between 0 and 1 and y between 0 and 1
        and text_start is null and text_end is null and quote is null)
    or (x is null and y is null and text_start is not null and text_end is not null and quote is not null
        and text_start >= 0 and text_end > text_start)
  ),
  -- Target of the reply FK below.
  unique (id, version_id),
  -- The version belongs to the piece, and the piece to the team.
  foreign key (version_id, piece_id) references public.piece_versions (id, piece_id) on delete cascade,
  foreign key (piece_id, team_id) references public.pieces (id, team_id) on delete cascade,
  -- A reply stays on its parent's version.
  foreign key (parent_id, version_id) references public.comments (id, version_id) on delete cascade
);

create index comments_version_id_idx on public.comments (version_id);
create index comments_piece_id_team_id_idx on public.comments (piece_id, team_id);
create index comments_team_id_idx on public.comments (team_id);
create index comments_parent_id_idx on public.comments (parent_id);
create index comments_author_id_idx on public.comments (author_id);

-- Grants: clients insert content columns only and update only `resolved`.
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;
grant insert (version_id, piece_id, team_id, author_id, body, x, y, text_start, text_end, quote, parent_id)
  on public.comments to authenticated;
grant update (resolved) on public.comments to authenticated;
grant all on public.comments to service_role;

alter table public.comments enable row level security;

create policy comments_select_members on public.comments
  for select to authenticated
  using (private.team_role_of(team_id) is not null);

create policy comments_insert_writers on public.comments
  for insert to authenticated
  with check (private.can_write(team_id) and author_id = auth.uid());

create policy comments_update_writers on public.comments
  for update to authenticated
  using (private.can_write(team_id))
  with check (private.can_write(team_id));

-- Thread and excerpt rules that need other rows. security invoker on purpose:
-- it runs before the RLS check, so it reads only rows the caller can already
-- see, and its errors cannot reveal another team's data. Rows it cannot see
-- are left for RLS and the foreign keys to reject.
create function private.comments_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_caption text;
begin
  if new.parent_id is not null then
    if exists (
      select 1 from public.comments p
      where p.id = new.parent_id and p.team_id = new.team_id and p.parent_id is not null
    ) then
      raise exception 'replies must point to a root comment' using errcode = '22023';
    end if;
    if new.x is not null or new.text_start is not null then
      raise exception 'replies have no target of their own' using errcode = '22023';
    end if;
  end if;

  -- Incomplete excerpts are left to the table check, which reports them as such.
  if new.text_start is not null and new.text_end is not null and new.quote is not null then
    select v.caption into v_caption
    from public.piece_versions v
    where v.id = new.version_id and v.piece_id = new.piece_id and v.team_id = new.team_id;
    if found and (
      v_caption is null
      or new.text_end > char_length(v_caption)
      or substring(v_caption from new.text_start + 1 for new.text_end - new.text_start) is distinct from new.quote
    ) then
      raise exception 'excerpt does not match the version caption' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- Writes the `comment` event. security definer: members cannot insert events.
create function private.comments_add_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.session_events (piece_id, team_id, author_id, kind, body, to_agent, delivery)
  values (
    new.piece_id, new.team_id, new.author_id, 'comment',
    jsonb_build_object('comment_id', new.id, 'version_id', new.version_id, 'parent_id', new.parent_id),
    false, 'not_applicable'
  );
  return null;
end
$$;

revoke all on function private.comments_validate() from public;
revoke all on function private.comments_add_event() from public;

create trigger comments_validate
  before insert on public.comments
  for each row execute function private.comments_validate();

create trigger comments_add_event
  after insert on public.comments
  for each row execute function private.comments_add_event();
