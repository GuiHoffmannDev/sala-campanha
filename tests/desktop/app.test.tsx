// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { AuthError } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAppClient } from '../../packages/desktop/src/data/client.ts'
import { saveDisplayName, sendLoginCode, verifyLoginCode } from '../../packages/desktop/src/data/auth.ts'
import { createCampaign } from '../../packages/desktop/src/data/campaigns.ts'
import { createWorkspace } from '../../packages/desktop/src/data/team.ts'
import * as teamData from '../../packages/desktop/src/data/team.ts'
import { App } from '../../packages/desktop/src/ui/App.tsx'
import { createPieceFixture, createTestTeam, env, loginCode, serviceClient } from '../helpers/supabase'

// Outside Tauri there are no sala:// links, so the tests deliver them by hand.
const deepLink = vi.hoisted(() => ({ deliver: (_url: string): void => {} }))
vi.mock('../../packages/desktop/src/native.ts', () => ({
  onDeepLink: async (cb: (url: string) => void) => {
    deepLink.deliver = cb
    return () => {}
  },
  openExternal: async () => {},
  copyText: async () => {},
}))
// Node's WebSocket rejects jsdom's events; the piece channel is tested in events.test.ts.
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/events.ts')>()),
  subscribePiece: () => () => {},
  subscribeMentions: () => () => {},
}))

// Presence sockets are exercised against the real server in presence.test.ts.
vi.mock('../../packages/desktop/src/data/presence.ts', () => ({
  joinTeamPresence: async () => ({ setPiece: async () => {}, leave: async () => {} }),
}))

// Node's WebSocket rejects jsdom's events; the live lists are tested in campaigns.test.ts.
vi.mock('../../packages/desktop/src/data/campaigns.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/campaigns.ts')>()),
  subscribeLists: () => () => {},
}))

const appClient = () => createAppClient(env.url, env.anonKey)

/** An app client signed in with an email code, the way a person signs in. */
async function signedIn(email: string) {
  const client = appClient()
  await sendLoginCode(client, email)
  await verifyLoginCode(client, email, await loginCode(email))
  return client
}

// Each client keeps its session in the jsdom localStorage, as the app does.
afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('renders the app title', () => {
  render(<App client={appClient()} />)
  expect(screen.getByText('Sala da Campanha')).toBeTruthy()
})

it('shows the login screen without a session', async () => {
  render(<App client={appClient()} />)
  expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy()
})

it('does not interpret a session lookup error as an empty membership list', async () => {
  const client = appClient()
  const error = new AuthError('session unavailable')
  vi.spyOn(client.auth, 'getSession').mockResolvedValueOnce({ data: { session: null }, error })
  await expect(teamData.loadMyMemberships(client)).rejects.toBe(error)
})

it('a new person names themselves, creates a workspace and sees it', async () => {
  const user = userEvent.setup()
  const email = `app-${randomUUID()}@test.local`
  const client = await signedIn(email)
  render(<App client={client} />)

  await user.type(await screen.findByLabelText('Your name'), 'Bia Lima')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  const field = (await screen.findByLabelText('Workspace name')) as HTMLInputElement
  expect(field.value).toBe('Workspace for Bia')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByText('Workspace for Bia')).toBeTruthy()

  const { data: { user: me } } = await client.auth.getUser()
  const { data } = await serviceClient().from('team_members').select('role, display_name, teams(name)').eq('user_id', me!.id)
  expect(data).toEqual([{ role: 'admin', display_name: 'Bia Lima', teams: { name: 'Workspace for Bia' } }])
})

it('an invited person with a name opens the app straight into the inviter\'s workspace', async () => {
  const teamName = `Agência ${randomUUID()}`
  const a = await createTestTeam(teamName)
  const email = `app-convite-${randomUUID()}@test.local`
  const { error } = await a.members.admin.client.rpc('invite_member', { p_team: a.teamId, p_email: email, p_role: 'gestor' })
  expect(error).toBeNull()
  // A returning person: the name is already saved, so the app skips the name step.
  const client = await signedIn(email)
  await saveDisplayName(client, 'Caio')

  render(<App client={client} />)
  expect(await screen.findByText(teamName)).toBeTruthy()
  expect(screen.queryByText('Create your workspace')).toBeNull()
})

it('a sign-in error from the browser goes away when the person asks for a code', async () => {
  const user = userEvent.setup()
  render(<App client={appClient()} />)
  await screen.findByRole('button', { name: 'Continue with Google' })
  act(() => deepLink.deliver('sala://auth/callback?error=access_denied'))
  expect(screen.getByRole('alert').textContent).toBe('Could not sign in. Try again.')

  await user.type(screen.getByLabelText('Email'), `app-erro-${randomUUID()}@test.local`)
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  expect(await screen.findByText(/^We sent a 6-digit code/)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('a sign-in error does not come back after signing in and out', async () => {
  const client = appClient()
  render(<App client={client} />)
  await screen.findByRole('button', { name: 'Continue with Google' })
  act(() => deepLink.deliver('sala://auth/callback?error=access_denied'))
  expect(screen.getByRole('alert')).toBeTruthy()

  // Signing in another way, here with the email code straight through the client.
  const email = `app-volta-${randomUUID()}@test.local`
  await sendLoginCode(client, email)
  await verifyLoginCode(client, email, await loginCode(email))
  expect(await screen.findByLabelText('Your name')).toBeTruthy()

  await act(async () => {
    await client.auth.signOut()
  })
  expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

/** A signed-in person with a name and a workspace of their own. */
async function personWithWorkspace(name: string) {
  const client = await signedIn(`app-${randomUUID()}@test.local`)
  await saveDisplayName(client, name)
  const teamId = await createWorkspace(client, `Workspace for ${name}`, name)
  const { data: { user } } = await client.auth.getUser()
  return { client, teamId, userId: user!.id }
}

it('a share link that arrives before sign-in opens after sign-in, in the workspace of the link', async () => {
  const email = `app-link-${randomUUID()}@test.local`
  const client = await signedIn(email)
  await saveDisplayName(client, 'Duda')
  await createWorkspace(client, 'Workspace for Duda', 'Duda')
  const { data: { user } } = await client.auth.getUser()
  const other = await createPieceFixture()
  const { error } = await serviceClient().from('team_members')
    .insert({ team_id: other.t.teamId, user_id: user!.id, role: 'espectador', display_name: 'Duda' })
  expect(error).toBeNull()
  await client.auth.signOut()

  render(<App client={client} />)
  await screen.findByRole('button', { name: 'Continue with Google' })
  act(() => deepLink.deliver(`sala://campanha/${other.campaignId}/peca/${other.pieceId.toUpperCase()}`))
  // A second code request within a minute is refused, so the code comes straight from the admin API.
  await act(async () => {
    await verifyLoginCode(client, email, await loginCode(email))
  })

  expect(await screen.findByRole('heading', { name: 'Peça de teste' })).toBeTruthy()
  expect((screen.getByLabelText('Workspace') as HTMLSelectElement).value).toBe(other.t.teamId)
  expect(localStorage.getItem('sala.workspace')).toBe(other.t.teamId)
})

it('a link to a piece the person cannot see shows a notice that goes away on click', async () => {
  const user = userEvent.setup()
  const { client, teamId } = await personWithWorkspace('Eva')
  const mine = await createCampaign(client, teamId, 'Campanha da Eva')
  const other = await createPieceFixture()
  render(<App client={client} />)
  await screen.findByText('Workspace for Eva')
  act(() => deepLink.deliver(`sala://campanha/${mine.id}`))
  expect(await screen.findByRole('heading', { name: 'Campanha da Eva' })).toBeTruthy()

  act(() => deepLink.deliver(`sala://campanha/${other.campaignId}/peca/${other.pieceId}`))
  const notice = await screen.findByText('Piece not found or access denied.')
  // Announced to screen readers, and the campaign the person had open stays open.
  expect(screen.getByRole('alert').contains(notice)).toBe(true)
  expect(screen.getByRole('heading', { name: 'Campanha da Eva' })).toBeTruthy()

  await user.click(notice)
  expect(screen.queryByText('Piece not found or access denied.')).toBeNull()
  expect(screen.getByText('Workspace for Eva')).toBeTruthy()
})

it('opens the remembered workspace and creates a new one from the sidebar', async () => {
  const user = userEvent.setup()
  const { client, userId } = await personWithWorkspace('Fábio')
  // Workspace names can repeat across people, including fixtures from earlier runs.
  await createTestTeam('Estúdio Fábio')
  const other = await createTestTeam('Agência Remota')
  await serviceClient().from('team_members').insert({ team_id: other.teamId, user_id: userId, role: 'designer', display_name: 'Fábio' })
  localStorage.setItem('sala.workspace', other.teamId)

  render(<App client={client} />)
  const select = (await screen.findByLabelText('Workspace')) as HTMLSelectElement
  expect(select.value).toBe(other.teamId)

  await user.click(screen.getByRole('button', { name: 'New workspace' }))
  await user.type(screen.getByLabelText('Workspace name'), 'Estúdio Fábio')
  await user.click(screen.getByRole('button', { name: 'Create workspace' }))
  await screen.findByRole('option', { name: 'Estúdio Fábio' })
  const { data, error } = await client.from('teams').select('id').eq('name', 'Estúdio Fábio').single()
  expect(error).toBeNull()
  await waitFor(() => expect((screen.getByLabelText('Workspace') as HTMLSelectElement).value).toBe(data!.id))
  expect(localStorage.getItem('sala.workspace')).toBe(data!.id)
})

it('refreshes workspace permissions after the admin changes their own role', async () => {
  const user = userEvent.setup()
  const t = await createTestTeam()
  const client = t.members.admin.client
  await saveDisplayName(client, 'Ana')
  await client.rpc('set_member_role', { p_team: t.teamId, p_user: t.members.gestor.userId, p_role: 'admin' })
  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: 'Workspace settings' }))
  await user.click(await screen.findByRole('tab', { name: 'Members' }))
  await user.selectOptions(screen.getByLabelText('Role for admin'), 'espectador')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Workspace settings' })).toBeNull())
  expect(screen.queryByRole('button', { name: 'New campaign' })).toBeNull()
})

it.each(['demote', 'remove'] as const)('closes settings and discards cached invites after another admin acts (%s)', async (action) => {
  const user = userEvent.setup()
  const t = await createTestTeam()
  const client = t.members.admin.client
  await saveDisplayName(client, 'Ana')
  expect((await client.rpc('set_member_role', { p_team: t.teamId, p_user: t.members.gestor.userId, p_role: 'admin' })).error).toBeNull()
  const email = `pending-${randomUUID()}@test.local`
  expect((await client.rpc('invite_member', { p_team: t.teamId, p_email: email, p_role: 'designer' })).error).toBeNull()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: 'Workspace settings' }))
  await user.type(await screen.findByLabelText('Key Anthropic'), 'unsaved-secret')
  await user.click(screen.getByRole('tab', { name: 'Members' }))
  expect(screen.getByText(`${email} — Designer`)).toBeTruthy()

  const result = action === 'demote'
    ? await t.members.gestor.client.rpc('set_member_role', { p_team: t.teamId, p_user: t.members.admin.userId, p_role: 'espectador' })
    : await t.members.gestor.client.rpc('remove_member', { p_team: t.teamId, p_user: t.members.admin.userId })
  expect(result.error).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Workspace settings' })).toBeNull())
  expect(screen.queryByLabelText('Key Anthropic')).toBeNull()
  expect(screen.queryByText(`${email} — Designer`)).toBeNull()
})

it('preserves unsaved settings during an unchanged permission refresh and discovers an external promotion on focus', async () => {
  const user = userEvent.setup()
  const t = await createTestTeam()
  const client = t.members.admin.client
  await saveDisplayName(client, 'Ana')
  expect((await client.rpc('set_member_role', { p_team: t.teamId, p_user: t.members.gestor.userId, p_role: 'admin' })).error).toBeNull()
  const loads = vi.spyOn(teamData, 'loadMyMemberships')
  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: 'Workspace settings' }))
  const key = await screen.findByLabelText('Key Anthropic')
  await user.type(key, 'unsaved-secret')
  const previousLoads = loads.mock.calls.length
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(loads.mock.calls.length).toBeGreaterThan(previousLoads))
  await act(async () => { await loads.mock.results.at(-1)!.value })
  expect(screen.getByLabelText('Key Anthropic')).toBe(key)
  expect(key).toHaveProperty('value', 'unsaved-secret')

  loads.mockRejectedValueOnce(new Error('fetch failed'))
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    await loads.mock.results.at(-1)!.value.catch(() => {})
  })
  expect(screen.getByLabelText('Key Anthropic')).toBe(key)
  expect(key).toHaveProperty('value', 'unsaved-secret')

  expect((await t.members.gestor.client.rpc('set_member_role', { p_team: t.teamId, p_user: t.members.admin.userId, p_role: 'espectador' })).error).toBeNull()
  await act(async () => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Workspace settings' })).toBeNull())
  expect((await t.members.gestor.client.rpc('set_member_role', { p_team: t.teamId, p_user: t.members.admin.userId, p_role: 'admin' })).error).toBeNull()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await user.click(await screen.findByRole('button', { name: 'Workspace settings' }))
  expect(await screen.findByLabelText('Key Anthropic')).toHaveProperty('value', '')
})

it('clears the removed workspace route before falling back to another workspace', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const client = f.t.members.admin.client
  await saveDisplayName(client, 'Ana')
  await createWorkspace(client, 'Outro workspace', 'Ana')
  expect((await client.rpc('set_member_role', { p_team: f.t.teamId, p_user: f.t.members.gestor.userId, p_role: 'admin' })).error).toBeNull()
  localStorage.setItem('sala.workspace', f.t.teamId)
  render(<App client={client} />)
  await screen.findByLabelText('Workspace')
  act(() => deepLink.deliver(`sala://campanha/${f.campaignId}/peca/${f.pieceId}`))
  expect(await screen.findByLabelText('Piece title')).toHaveProperty('value', 'Peça de teste')
  await user.click(screen.getByRole('button', { name: 'Workspace settings' }))
  await screen.findByLabelText('Key Anthropic')

  expect((await f.t.members.gestor.client.rpc('remove_member', { p_team: f.t.teamId, p_user: f.t.members.admin.userId })).error).toBeNull()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(await screen.findByRole('heading', { name: 'Outro workspace' })).toBeTruthy()
  expect(screen.queryByLabelText('Piece title')).toBeNull()
  expect(screen.queryByRole('region', { name: 'Piece chat' })).toBeNull()
  expect(screen.getByText('Choose a piece')).toBeTruthy()
})
