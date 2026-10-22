-- Teams, members and roles. Every later table scopes its RLS through the
-- helper functions in the `private` schema defined here.

create type public.team_role as enum ('admin', 'gestor', 'designer', 'espectador');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null,
  display_name text not null,
  primary key (team_id, user_id)
);

-- Lookups by user (e.g. "which teams am I in") are not covered by the pk order.
create index team_members_user_id_idx on public.team_members (user_id);

-- Helper schema: not exposed by the Data API.
create schema if not exists private;
revoke all on schema private from public;
-- Policies call these helpers as the querying role, so it needs usage + execute.
grant usage on schema private to authenticated, service_role;

-- security definer: reads team_members without recursing into its own RLS.
-- Only ever answers for auth.uid(), so it cannot reveal another user's role.
create function private.team_role_of(p_team uuid)
returns public.team_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.team_members m
  where m.team_id = p_team
    and m.user_id = auth.uid()
$$;

create function private.can_write(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.team_role_of(p_team) <> 'espectador', false)
$$;

create function private.can_approve(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.team_role_of(p_team) in ('admin', 'gestor'), false)
$$;

revoke all on function private.team_role_of(uuid) from public;
revoke all on function private.can_write(uuid) from public;
revoke all on function private.can_approve(uuid) from public;
grant execute on function private.team_role_of(uuid) to authenticated, service_role;
grant execute on function private.can_write(uuid) to authenticated, service_role;
grant execute on function private.can_approve(uuid) to authenticated, service_role;

-- Grants: members only read. Teams and members are managed with the service
-- role (admin RPCs for member management arrive in Plan 3).
revoke all on public.teams, public.team_members from anon, authenticated;
grant select on public.teams, public.team_members to authenticated;
grant all on public.teams, public.team_members to service_role;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create policy teams_select_members on public.teams
  for select to authenticated
  using (private.team_role_of(id) is not null);

create policy team_members_select_members on public.team_members
  for select to authenticated
  using (private.team_role_of(team_id) is not null);
