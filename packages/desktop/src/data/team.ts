import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@sala/shared'

export type Membership = { teamId: string; teamName: string; role: Role; displayName: string }
export type Member = { userId: string; displayName: string; role: Role }
export type Invite = { email: string; role: Role; created_at: string }

export async function inviteMember(client: SupabaseClient, teamId: string, email: string, role: Role): Promise<void> {
  const { error } = await client.rpc('invite_member', { p_team: teamId, p_email: email, p_role: role })
  if (error) throw error
}

export async function loadInvites(client: SupabaseClient, teamId: string): Promise<Invite[]> {
  const { data, error } = await client.from('team_invites').select('email, role, created_at').eq('team_id', teamId).order('email')
  if (error) throw error
  return data as Invite[]
}

export async function revokeInvite(client: SupabaseClient, teamId: string, email: string): Promise<void> {
  const { error } = await client.rpc('revoke_invite', { p_team: teamId, p_email: email })
  if (error) throw error
}

export async function setMemberRole(client: SupabaseClient, teamId: string, userId: string, role: Role): Promise<void> {
  const { error } = await client.rpc('set_member_role', { p_team: teamId, p_user: userId, p_role: role })
  if (error) throw error
}

export async function removeMember(client: SupabaseClient, teamId: string, userId: string): Promise<void> {
  const { error } = await client.rpc('remove_member', { p_team: teamId, p_user: userId })
  if (error) throw error
}

// Sorted here, not in SQL, so accented names sort the way a Brazilian reader expects.
const byName = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

/** Joins every workspace that invited the person's confirmed email. Returns how many it joined. */
export async function acceptInvites(client: SupabaseClient, displayName: string): Promise<number> {
  const { data, error } = await client.rpc('accept_invites', { p_display_name: displayName })
  if (error) throw error
  return data as number
}

/** Creates a workspace with the caller as its admin and returns its id. */
export async function createWorkspace(client: SupabaseClient, name: string, displayName: string): Promise<string> {
  const { data, error } = await client.rpc('create_workspace', { p_name: name, p_display_name: displayName })
  if (error) throw error
  return data as string
}

/** The workspaces of the signed-in person, by workspace name. */
export async function loadMyMemberships(client: SupabaseClient): Promise<Membership[]> {
  const { data: { session }, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  if (!session) return []
  const { data, error } = await client.from('team_members')
    .select('team_id, role, display_name, teams(name)')
    .eq('user_id', session.user.id)
  if (error) throw error
  const rows = data as unknown as { team_id: string; role: Role; display_name: string; teams: { name: string } }[]
  return rows
    .map((r) => ({ teamId: r.team_id, teamName: r.teams.name, role: r.role, displayName: r.display_name }))
    .sort((a, b) => byName(a.teamName, b.teamName))
}

/** The people of a workspace, by name. */
export async function loadMembers(client: SupabaseClient, teamId: string): Promise<Member[]> {
  const { data, error } = await client.from('team_members').select('user_id, display_name, role').eq('team_id', teamId)
  if (error) throw error
  const rows = data as { user_id: string; display_name: string; role: Role }[]
  return rows
    .map((r) => ({ userId: r.user_id, displayName: r.display_name, role: r.role }))
    .sort((a, b) => byName(a.displayName, b.displayName))
}
