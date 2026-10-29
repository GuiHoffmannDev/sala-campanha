-- App support (Plan 3): personal workspaces, invites accepted by the verified
-- owner of the email, member management, private team presence and live
-- campaign lists. Sign-up is open, so every write here goes through RPCs that
-- check the caller; the app never uses the service role.

-- Open sign-up --------------------------------------------------------------

-- The Auth API also takes email + password sign-ups, so anyone can create an
-- unconfirmed account with a password for someone else's email. When the owner
-- later confirms that email (code or OAuth), the password set before it was
-- proven would still let the other person in. The app never signs in with a
-- password, so the password is dropped the moment the email is confirmed.
create function private.drop_unproven_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

revoke all on function private.drop_unproven_password() from public;

create trigger drop_unproven_password
  before update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.drop_unproven_password();

-- Private team presence -----------------------------------------------------

-- The team id of a presence topic `team:<lowercase uuid>`; null for any other format.
create function private.topic_team(p_topic text)
returns uuid
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^team:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substr(p_topic, 6)::uuid
  end
$$;

revoke all on function private.topic_team(text) from public;
grant execute on function private.topic_team(text) to authenticated, service_role;

-- Realtime authorizes private channels with these policies when a client
-- joins: only members of the team may read or send presence on `team:<id>`.
create policy team_presence_select_members on realtime.messages
  for select to authenticated
  using (extension = 'presence' and private.team_role_of(private.topic_team(realtime.topic())) is not null);
create policy team_presence_insert_members on realtime.messages
  for insert to authenticated
  with check (extension = 'presence' and private.team_role_of(private.topic_team(realtime.topic())) is not null);

-- Workspaces ----------------------------------------------------------------

-- Creates a team (a "workspace" in the app) with the caller as its admin.
create function public.create_workspace(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
  v_display_name text := btrim(p_display_name);
  v_team uuid;
begin
  if coalesce(v_name, '') = '' or length(v_name) > 80 then
    raise exception 'workspace name must not be empty' using errcode = '22023';
  end if;
  if coalesce(v_display_name, '') = '' or length(v_display_name) > 80 then
    raise exception 'display name must not be empty' using errcode = '22023';
  end if;

  insert into public.teams (name) values (v_name) returning id into v_team;
  insert into public.team_members (team_id, user_id, role, display_name)
  values (v_team, auth.uid(), 'admin', v_display_name);
  return v_team;
end;
$$;

-- Invites -------------------------------------------------------------------

create table public.team_invites (
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.team_role not null,
  invited_by uuid null default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, email)
);

-- accept_invites looks invites up by email across teams.
create index team_invites_email_idx on public.team_invites (email);

-- Admins read their team's invites; every write goes through the RPCs below.
revoke all on public.team_invites from anon, authenticated;
grant select on public.team_invites to authenticated;
grant all on public.team_invites to service_role;

alter table public.team_invites enable row level security;

create policy team_invites_select_admins on public.team_invites
  for select to authenticated
  using (private.team_role_of(team_id) = 'admin');

-- Invites an email to the team, or changes the role of a pending invite.
create function public.invite_member(p_team uuid, p_email text, p_role public.team_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Emails are often pasted with spaces or a trailing newline around them.
  v_email text := lower(btrim(p_email, E' \t\r\n'));
begin
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can invite' using errcode = '42501';
  end if;
  if v_email is null or position('@' in v_email) = 0 or v_email ~ '\s' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.team_members m
    join auth.users u on u.id = m.user_id
    where m.team_id = p_team and lower(u.email) = v_email
  ) then
    raise exception 'user is already a team member' using errcode = '22023';
  end if;

  insert into public.team_invites (team_id, email, role)
  values (p_team, v_email, p_role)
  on conflict (team_id, email) do update set role = excluded.role;
end;
$$;

create function public.revoke_invite(p_team uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can invite' using errcode = '42501';
  end if;
  delete from public.team_invites i
  where i.team_id = p_team and i.email = lower(btrim(p_email, E' \t\r\n'));
end;
$$;

-- Joins every team that invited the caller's email, but only once that email
-- is confirmed: with open sign-up, an unconfirmed account proves nothing.
-- Returns how many teams the caller joined.
create function public.accept_invites(p_display_name text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := btrim(p_display_name);
  v_email text;
  v_joined int;
begin
  if coalesce(v_display_name, '') = '' or length(v_display_name) > 80 then
    raise exception 'display name must not be empty' using errcode = '22023';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  with accepted as (
    delete from public.team_invites i
    where i.email = v_email
    returning i.team_id, i.role
  ), joined as (
    insert into public.team_members (team_id, user_id, role, display_name)
    select a.team_id, auth.uid(), a.role, v_display_name
    from accepted a
    on conflict do nothing
    returning 1
  )
  select count(*) into v_joined from joined;
  return v_joined;
end;
$$;

-- Members -------------------------------------------------------------------

-- Both functions refuse non-admins before locking, so nobody outside the team
-- can lock its member rows. Then they lock the team's member rows and check the
-- caller's role again against the latest state, so two admins demoting or
-- removing each other at the same time cannot leave the team without an admin.
create function public.set_member_role(p_team uuid, p_user uuid, p_role public.team_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.team_role;
begin
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can manage members' using errcode = '42501';
  end if;
  perform 1 from public.team_members m where m.team_id = p_team for update;
  -- Checked again after the lock: a concurrent call may have demoted or removed the caller.
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can manage members' using errcode = '42501';
  end if;

  select m.role into v_current
  from public.team_members m
  where m.team_id = p_team and m.user_id = p_user;
  if not found then
    raise exception 'user is not a team member' using errcode = '22023';
  end if;
  if v_current = 'admin' and p_role is distinct from 'admin' and not exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.role = 'admin' and m.user_id <> p_user
  ) then
    raise exception 'team needs at least one admin' using errcode = '22023';
  end if;

  update public.team_members m set role = p_role
  where m.team_id = p_team and m.user_id = p_user;
end;
$$;

create function public.remove_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.team_role;
begin
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can manage members' using errcode = '42501';
  end if;
  perform 1 from public.team_members m where m.team_id = p_team for update;
  -- Checked again after the lock: a concurrent call may have demoted or removed the caller.
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can manage members' using errcode = '42501';
  end if;

  select m.role into v_current
  from public.team_members m
  where m.team_id = p_team and m.user_id = p_user;
  if not found then
    raise exception 'user is not a team member' using errcode = '22023';
  end if;
  if v_current = 'admin' and not exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.role = 'admin' and m.user_id <> p_user
  ) then
    raise exception 'team needs at least one admin' using errcode = '22023';
  end if;

  delete from public.team_members m
  where m.team_id = p_team and m.user_id = p_user;
end;
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
revoke all on function public.invite_member(uuid, text, public.team_role) from public, anon;
revoke all on function public.revoke_invite(uuid, text) from public, anon;
revoke all on function public.accept_invites(text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.team_role) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.invite_member(uuid, text, public.team_role) to authenticated;
grant execute on function public.revoke_invite(uuid, text) to authenticated;
grant execute on function public.accept_invites(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.team_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Live lists ----------------------------------------------------------------

-- The app's sidebar and reference library follow these tables live. As in
-- 0008, Realtime filters INSERT/UPDATE by the select policies; clients cannot
-- delete from either table, so DELETE changes (primary key only) stay rare.
alter publication supabase_realtime add table public.campaigns, public.reference_assets;
