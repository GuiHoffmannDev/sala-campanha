-- Comments on a piece version, optionally pinned to a point of the image.
-- x and y are relative to the image (0..1); without them the comment is a
-- plain comment on the version. Replies point to their root via parent_id.

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
  parent_id uuid null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  check ((x is null) = (y is null) and (x is null or (x between 0 and 1 and y between 0 and 1))),
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
grant insert (version_id, piece_id, team_id, author_id, body, x, y, parent_id) on public.comments to authenticated;
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
