-- Campaigns, pieces, reference assets and the private `team-files` bucket.
-- Every row carries `team_id` so RLS can scope it with the helpers from 0001.

create type public.piece_status as enum (
  'gerando', 'base_em_revisao', 'acabamento', 'final_em_revisao', 'aprovada'
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  -- Target of the composite FKs below: children must belong to the campaign's team.
  unique (id, team_id)
);

create table public.pieces (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  team_id uuid not null,
  title text not null,
  kind text not null check (kind in ('imagem', 'texto', 'imagem_texto')),
  status public.piece_status not null default 'gerando',
  -- FK to piece_versions is added with that table (Task 7).
  approved_version_id uuid null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, team_id) references public.campaigns (id, team_id) on delete cascade
);

create table public.reference_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  team_id uuid not null,
  storage_path text not null check (storage_path like team_id::text || '/%'),
  original_name text not null,
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, team_id) references public.campaigns (id, team_id) on delete cascade
);

create index campaigns_team_id_idx on public.campaigns (team_id);
create index pieces_campaign_id_idx on public.pieces (campaign_id, team_id);
create index pieces_team_id_idx on public.pieces (team_id);
create index reference_assets_campaign_id_idx on public.reference_assets (campaign_id, team_id);
create index reference_assets_team_id_idx on public.reference_assets (team_id);

-- Grants: column lists keep author, status and approved version out of client
-- hands. Authors default to auth.uid(); status and approval change only via RPC (Task 7).
revoke all on public.campaigns, public.pieces, public.reference_assets from anon, authenticated;
grant select on public.campaigns, public.pieces, public.reference_assets to authenticated;
grant insert (team_id, name) on public.campaigns to authenticated;
grant insert (campaign_id, team_id, title, kind) on public.pieces to authenticated;
grant update (title) on public.pieces to authenticated;
grant insert (campaign_id, team_id, storage_path, original_name) on public.reference_assets to authenticated;
grant all on public.campaigns, public.pieces, public.reference_assets to service_role;

alter table public.campaigns enable row level security;
alter table public.pieces enable row level security;
alter table public.reference_assets enable row level security;

create policy campaigns_select_members on public.campaigns
  for select to authenticated
  using (private.team_role_of(team_id) is not null);
create policy campaigns_insert_writers on public.campaigns
  for insert to authenticated
  with check (private.can_write(team_id));

create policy pieces_select_members on public.pieces
  for select to authenticated
  using (private.team_role_of(team_id) is not null);
create policy pieces_insert_writers on public.pieces
  for insert to authenticated
  with check (private.can_write(team_id));
create policy pieces_update_writers on public.pieces
  for update to authenticated
  using (private.can_write(team_id))
  with check (private.can_write(team_id));

create policy reference_assets_select_members on public.reference_assets
  for select to authenticated
  using (private.team_role_of(team_id) is not null);
create policy reference_assets_insert_writers on public.reference_assets
  for insert to authenticated
  with check (private.can_write(team_id));

-- Storage: private bucket, every object path starts with `<team_id>/`.
insert into storage.buckets (id, name, public)
values ('team-files', 'team-files', false);

-- Team owning an object path, or null when the first segment is not a uuid.
-- Avoids a cast error aborting the whole query on a malformed path.
create function private.path_team(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

revoke all on function private.path_team(text) from public;
grant execute on function private.path_team(text) to authenticated, service_role;

create policy team_files_select_members on storage.objects
  for select to authenticated
  using (bucket_id = 'team-files' and private.team_role_of(private.path_team(name)) is not null);
create policy team_files_insert_writers on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-files' and private.can_write(private.path_team(name)));
create policy team_files_update_writers on storage.objects
  for update to authenticated
  using (bucket_id = 'team-files' and private.can_write(private.path_team(name)))
  with check (bucket_id = 'team-files' and private.can_write(private.path_team(name)));
create policy team_files_delete_writers on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-files' and private.can_write(private.path_team(name)));
