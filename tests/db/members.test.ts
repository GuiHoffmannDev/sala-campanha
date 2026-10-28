import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, createTestTeam, dbQuery, serviceClient, uploadTeamFile } from '../helpers/supabase'
import { closeChannels, foreign, joinPresence, listen, waitFor, warmUpRealtime } from '../helpers/realtime'

type NewUser = { userId: string; email: string; client: SupabaseClient }

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@test.local`

/** Creates a confirmed user with no team and signs in with an email code, the way the app does. */
async function signInNewUser(email = newEmail('user')): Promise<NewUser> {
  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkError || !link) throw new Error(`generateLink failed: ${linkError?.message}`)
  const client = anonClient()
  const { error: otpError } = await client.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' })
  if (otpError) throw new Error(`verifyOtp failed: ${otpError.message}`)
  return { userId: data.user.id, email, client }
}

/** Pending invites of a team, read with the service role. */
async function invitesOf(teamId: string): Promise<{ email: string; role: string }[]> {
  const { data, error } = await serviceClient().from('team_invites').select('email, role').eq('team_id', teamId).order('email')
  if (error) throw new Error(`read invites failed: ${error.message}`)
  return data
}

async function roleOf(teamId: string, userId: string): Promise<string | null> {
  const { data } = await serviceClient().from('team_members').select('role')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle()
  return data?.role ?? null
}

const invite = (client: SupabaseClient, team: string, email: string, role = 'designer') =>
  client.rpc('invite_member', { p_team: team, p_email: email, p_role: role })

afterEach(closeChannels)
beforeAll(warmUpRealtime, 40_000)

it('create_workspace makes the caller its admin', async () => {
  const u = await signInNewUser()
  const { data: teamId, error } = await u.client.rpc('create_workspace', { p_name: ' Meu workspace ', p_display_name: 'Ana' })
  expect(error).toBeNull()

  const { data: teams } = await u.client.from('teams').select('id, name')
  expect(teams).toEqual([{ id: teamId, name: 'Meu workspace' }])
  const { data: members } = await u.client.from('team_members').select('user_id, role, display_name').eq('team_id', teamId)
  expect(members).toEqual([{ user_id: u.userId, role: 'admin', display_name: 'Ana' }])
})

it('create_workspace refuses empty or long names', async () => {
  const u = await signInNewUser()
  const create = (p_name: string, p_display_name: string) => u.client.rpc('create_workspace', { p_name, p_display_name })
  const badName = { code: '22023', message: 'workspace name must not be empty' }
  const badDisplay = { code: '22023', message: 'display name must not be empty' }

  expect((await create('   ', 'Ana')).error).toMatchObject(badName)
  expect((await create('x'.repeat(81), 'Ana')).error).toMatchObject(badName)
  expect((await create('Workspace', ' ')).error).toMatchObject(badDisplay)
  expect((await create('Workspace', 'x'.repeat(81))).error).toMatchObject(badDisplay)
  const { data } = await u.client.from('teams').select('id')
  expect(data).toEqual([])
})

it('an invite is accepted only by the verified owner of the email', async () => {
  const a = await createTestTeam()
  const email = newEmail('x')
  expect((await invite(a.members.admin.client, a.teamId, email, 'designer')).error).toBeNull()

  // Verifying a code confirms the email in GoTrue, so an unconfirmed account
  // holding a session is simulated by clearing the confirmation afterwards.
  const x = await signInNewUser(email)
  await dbQuery('update auth.users set email_confirmed_at = null where id = $1', [x.userId])
  expect(await x.client.rpc('accept_invites', { p_display_name: 'Xavier' })).toMatchObject({ error: null, data: 0 })
  expect(await roleOf(a.teamId, x.userId)).toBeNull()
  expect(await invitesOf(a.teamId)).toEqual([{ email, role: 'designer' }])

  const { error } = await serviceClient().auth.admin.updateUserById(x.userId, { email_confirm: true })
  expect(error).toBeNull()
  expect(await x.client.rpc('accept_invites', { p_display_name: 'Xavier' })).toMatchObject({ error: null, data: 1 })
  const { data: member } = await x.client.from('team_members').select('role, display_name')
    .eq('team_id', a.teamId).eq('user_id', x.userId).single()
  expect(member).toEqual({ role: 'designer', display_name: 'Xavier' })
  expect(await invitesOf(a.teamId)).toEqual([])
})

it('a password sign-up cannot claim an invite before confirming the email', async () => {
  const a = await createTestTeam()
  const email = newEmail('y')
  expect((await invite(a.members.admin.client, a.teamId, email)).error).toBeNull()

  // Open sign-up also accepts email + password through the API; without a
  // confirmed email that account must get no session to accept with.
  const intruder = anonClient()
  const password = 'intruder-password-1234'
  const signUp = await intruder.auth.signUp({ email, password })
  expect(signUp.error).toBeNull()
  expect(signUp.data.session).toBeNull()
  const signIn = await intruder.auth.signInWithPassword({ email, password })
  expect(signIn.error?.message).toBe('Email not confirmed')
  expect(await invitesOf(a.teamId)).toEqual([{ email, role: 'designer' }])
})

it('a password set before the email was confirmed stops working once the owner confirms it', async () => {
  const email = newEmail('owner')
  const password = 'intruder-password-1234'
  // Someone else creates the account first, with a password, for the owner's email.
  expect((await anonClient().auth.signUp({ email, password })).error).toBeNull()

  // The owner later signs in with an email code, which confirms the email.
  const { data: link, error: linkError } = await serviceClient().auth.admin.generateLink({ type: 'magiclink', email })
  expect(linkError).toBeNull()
  const owner = anonClient()
  const verified = await owner.auth.verifyOtp({ email, token: link.properties?.email_otp ?? '', type: 'email' })
  expect(verified.error).toBeNull()
  expect(verified.data.user?.email_confirmed_at).toBeTruthy()

  const intruder = await anonClient().auth.signInWithPassword({ email, password })
  expect(intruder.error?.message).toBe('Invalid login credentials')
  expect(intruder.data.session).toBeNull()
})

it('only admins invite', async () => {
  const a = await createTestTeam()
  const b = await createTestTeam()
  for (const m of [a.members.gestor, a.members.designer, a.members.espectador, b.members.admin]) {
    expect((await invite(m.client, a.teamId, newEmail('z'))).error)
      .toMatchObject({ code: '42501', message: 'only team admins can invite' })
  }
  expect(await invitesOf(a.teamId)).toEqual([])
})

it('only admins revoke an invite', async () => {
  const a = await createTestTeam()
  const email = newEmail('r')
  expect((await invite(a.members.admin.client, a.teamId, email)).error).toBeNull()

  const byGestor = await a.members.gestor.client.rpc('revoke_invite', { p_team: a.teamId, p_email: email })
  expect(byGestor.error).toMatchObject({ code: '42501', message: 'only team admins can invite' })
  expect(await invitesOf(a.teamId)).toHaveLength(1)

  const byAdmin = await a.members.admin.client.rpc('revoke_invite', { p_team: a.teamId, p_email: ` ${email.toUpperCase()} ` })
  expect(byAdmin.error).toBeNull()
  expect(await invitesOf(a.teamId)).toEqual([])
})

it('invite_member checks the email, stores it trimmed and lowercased, and the last role wins', async () => {
  const a = await createTestTeam()
  const admin = a.members.admin.client
  for (const bad of ['sem-arroba.test.local', 'com espaco@test.local', '  ']) {
    expect((await invite(admin, a.teamId, bad)).error).toMatchObject({ code: '22023', message: 'invalid email' })
  }

  const email = newEmail('w')
  expect((await invite(admin, a.teamId, `  ${email.toUpperCase()}\n`, 'designer')).error).toBeNull()
  expect((await invite(admin, a.teamId, email, 'gestor')).error).toBeNull()
  expect(await invitesOf(a.teamId)).toEqual([{ email, role: 'gestor' }])
})

it('inviting a current member is refused', async () => {
  const a = await createTestTeam()
  const { data } = await serviceClient().auth.admin.getUserById(a.members.designer.userId)
  const email = data.user?.email
  if (!email) throw new Error('designer has no email')

  expect((await invite(a.members.admin.client, a.teamId, email.toUpperCase(), 'gestor')).error)
    .toMatchObject({ code: '22023', message: 'user is already a team member' })
  expect(await invitesOf(a.teamId)).toEqual([])
})

it('members of another team cannot read the invites', async () => {
  const a = await createTestTeam()
  const b = await createTestTeam()
  const email = newEmail('v')
  expect((await invite(a.members.admin.client, a.teamId, email)).error).toBeNull()

  const own = await a.members.admin.client.from('team_invites').select('email').eq('team_id', a.teamId)
  expect(own.data).toEqual([{ email }])
  // Invites are admin-only, so a non-admin of the same team sees nothing either.
  for (const reader of [b.members.admin, b.members.designer, a.members.gestor]) {
    const { data, error } = await reader.client.from('team_invites').select('email').eq('team_id', a.teamId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  }
  // No direct writes: invites change only through the RPCs.
  const direct = await a.members.admin.client.from('team_invites').insert({ team_id: a.teamId, email: newEmail('d'), role: 'admin' })
  expect(direct.error?.code).toBe('42501')
})

it('admin changes a role; the last admin cannot be demoted or removed', async () => {
  const a = await createTestTeam()
  const admin = a.members.admin.client
  const { admin: first, designer, gestor, espectador } = a.members
  const setRole = (c: SupabaseClient, p_user: string, p_role: string) => c.rpc('set_member_role', { p_team: a.teamId, p_user, p_role })
  const remove = (c: SupabaseClient, p_user: string) => c.rpc('remove_member', { p_team: a.teamId, p_user })
  const lastAdmin = { code: '22023', message: 'team needs at least one admin' }
  const notAdmin = { code: '42501', message: 'only team admins can manage members' }
  const notMember = { code: '22023', message: 'user is not a team member' }

  expect((await setRole(admin, designer.userId, 'gestor')).error).toBeNull()
  expect(await roleOf(a.teamId, designer.userId)).toBe('gestor')

  expect((await setRole(admin, first.userId, 'designer')).error).toMatchObject(lastAdmin)
  expect((await remove(admin, first.userId)).error).toMatchObject(lastAdmin)
  expect(await roleOf(a.teamId, first.userId)).toBe('admin')

  expect((await setRole(gestor.client, espectador.userId, 'admin')).error).toMatchObject(notAdmin)
  expect((await remove(gestor.client, espectador.userId)).error).toMatchObject(notAdmin)
  expect(await roleOf(a.teamId, espectador.userId)).toBe('espectador')

  expect((await setRole(admin, randomUUID(), 'designer')).error).toMatchObject(notMember)
  expect((await remove(admin, randomUUID())).error).toMatchObject(notMember)

  // With a second admin, the first one may step down.
  expect((await setRole(admin, designer.userId, 'admin')).error).toBeNull()
  expect((await remove(admin, first.userId)).error).toBeNull()
  expect(await roleOf(a.teamId, first.userId)).toBeNull()
})

it('members of another team cannot join the team presence channel', async () => {
  const a = await createTestTeam()
  const b = await createTestTeam()
  expect(await joinPresence(b.members.designer.client, `team:${a.teamId}`)).toBe('CHANNEL_ERROR')
  expect(await joinPresence(a.members.designer.client, `team:${a.teamId}`)).toBe('SUBSCRIBED')
  // Only the exact lowercase topic maps to the team.
  expect(await joinPresence(a.members.gestor.client, `team:${a.teamId.toUpperCase()}`)).toBe('CHANNEL_ERROR')
})

it('new campaigns reach other members live', async () => {
  const a = await createTestTeam()
  const b = await createTestTeam()
  const aReceived = await listen(a.members.designer.client, [
    { table: 'campaigns', filter: `team_id=eq.${a.teamId}` },
    { table: 'reference_assets', filter: `team_id=eq.${a.teamId}` },
  ])
  // B knows A's team id and also listens to everything: neither may leak.
  const bReceived = await listen(b.members.designer.client, [
    { table: 'campaigns', filter: `team_id=eq.${a.teamId}` },
    { table: 'reference_assets' },
  ])

  const { data: campaign, error } = await a.members.gestor.client.from('campaigns')
    .insert({ team_id: a.teamId, name: 'Black Friday' }).select('id').single()
  expect(error).toBeNull()
  const path = await uploadTeamFile(`${a.teamId}/${campaign?.id}/${randomUUID()}.png`)
  const asset = await a.members.gestor.client.from('reference_assets')
    .insert({ campaign_id: campaign?.id, team_id: a.teamId, storage_path: path, original_name: 'produto.png' })
  expect(asset.error).toBeNull()

  await waitFor(() => aReceived.length >= 2)
  expect(aReceived.map((c) => `${c.table}:${c.eventType}`)).toEqual(['campaigns:INSERT', 'reference_assets:INSERT'])
  expect(aReceived[0]).toMatchObject({ new: { id: campaign?.id, team_id: a.teamId } })
  expect(foreign(aReceived, a.teamId)).toEqual([])
  expect(bReceived).toEqual([])
})
