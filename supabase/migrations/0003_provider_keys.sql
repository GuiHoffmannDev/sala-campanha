-- Team provider keys. The plaintext lives only in Supabase Vault; the table
-- keeps a pointer to the secret and the last 4 characters for the mask.
-- Members read the mask; only admins write, and only through the RPCs below.
-- Plaintext is readable only by the service role (agent executor, Plan 2).

create type public.provider as enum ('openai', 'anthropic', 'gemini', 'fal', 'krea');

create table public.provider_keys (
  team_id uuid not null references public.teams (id) on delete cascade,
  provider public.provider not null,
  vault_secret_id uuid not null,
  last4 text not null,
  -- Null once the author's account is deleted; the key itself stays valid.
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, provider)
);

-- Grants: members read only the columns in the Task 4 contract; `vault_secret_id`
-- and `updated_by` stay hidden. No client writes.
revoke all on public.provider_keys from anon, authenticated;
grant select (team_id, provider, last4, updated_at) on public.provider_keys to authenticated;
grant all on public.provider_keys to service_role;

alter table public.provider_keys enable row level security;

create policy provider_keys_select_members on public.provider_keys
  for select to authenticated
  using (private.team_role_of(team_id) is not null);

-- Removing a row (RPC, or team deletion via cascade) also removes its secret,
-- so no orphaned plaintext stays in the Vault.
create function private.delete_provider_key_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end
$$;

revoke all on function private.delete_provider_key_secret() from public;

create trigger provider_keys_delete_secret
  after delete on public.provider_keys
  for each row execute function private.delete_provider_key_secret();

create function public.set_provider_key(p_team uuid, p_provider public.provider, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can set provider keys' using errcode = '42501';
  end if;
  -- Every supported provider issues keys well over 20 characters; a shorter
  -- minimum would let the 4-character mask reveal a large share of the key.
  if p_key is null or length(p_key) < 20 then
    raise exception 'provider key must have at least 20 characters' using errcode = '22023';
  end if;

  -- Lock the row so two concurrent saves cannot each create a secret.
  select k.vault_secret_id into v_secret_id
  from public.provider_keys k
  where k.team_id = p_team and k.provider = p_provider
  for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_key);
    insert into public.provider_keys (team_id, provider, vault_secret_id, last4, updated_by)
    values (p_team, p_provider, v_secret_id, right(p_key, 4), auth.uid());
  else
    -- If the secret was removed outside these RPCs, update_secret would be a
    -- silent no-op; store a fresh secret so the row never points at nothing.
    if exists (select 1 from vault.secrets s where s.id = v_secret_id) then
      perform vault.update_secret(v_secret_id, p_key);
    else
      v_secret_id := vault.create_secret(p_key);
    end if;
    update public.provider_keys
    set vault_secret_id = v_secret_id, last4 = right(p_key, 4), updated_by = auth.uid(), updated_at = now()
    where team_id = p_team and provider = p_provider;
  end if;
end
$$;

create function public.delete_provider_key(p_team uuid, p_provider public.provider)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.team_role_of(p_team) is distinct from 'admin' then
    raise exception 'only team admins can delete provider keys' using errcode = '42501';
  end if;
  -- The delete trigger removes the Vault secret.
  delete from public.provider_keys where team_id = p_team and provider = p_provider;
end
$$;

-- Returns the plaintext key, or null when the team has none for the provider.
create function public.get_provider_key_for_executor(p_team uuid, p_provider public.provider)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.provider_keys k
  join vault.decrypted_secrets s on s.id = k.vault_secret_id
  where k.team_id = p_team and k.provider = p_provider
$$;

revoke all on function public.set_provider_key(uuid, public.provider, text) from public, anon;
revoke all on function public.delete_provider_key(uuid, public.provider) from public, anon;
revoke all on function public.get_provider_key_for_executor(uuid, public.provider) from public, anon, authenticated;
grant execute on function public.set_provider_key(uuid, public.provider, text) to authenticated;
grant execute on function public.delete_provider_key(uuid, public.provider) to authenticated;
grant execute on function public.get_provider_key_for_executor(uuid, public.provider) to service_role;
