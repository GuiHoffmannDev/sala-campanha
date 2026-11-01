// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAppClient } from '../../packages/desktop/src/data/client.ts'
import { saveDisplayName, sendLoginCode, verifyLoginCode } from '../../packages/desktop/src/data/auth.ts'
import { createCampaign } from '../../packages/desktop/src/data/campaigns.ts'
import { createWorkspace } from '../../packages/desktop/src/data/team.ts'
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
afterEach(() => localStorage.clear())

it('renders the app title', () => {
  render(<App client={appClient()} />)
  expect(screen.getByText('Sala da Campanha')).toBeTruthy()
})

it('shows the login screen without a session', async () => {
  render(<App client={appClient()} />)
  expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
})

it('a new person names themselves, creates a workspace and sees it', async () => {
  const user = userEvent.setup()
  const email = `app-${randomUUID()}@test.local`
  const client = await signedIn(email)
  render(<App client={client} />)

  await user.type(await screen.findByLabelText('Seu nome'), 'Bia Lima')
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  const field = (await screen.findByLabelText('Nome do workspace')) as HTMLInputElement
  expect(field.value).toBe('Workspace de Bia')
  await user.click(screen.getByRole('button', { name: 'Criar' }))
  expect(await screen.findByText('Workspace de Bia')).toBeTruthy()

  const { data: { user: me } } = await client.auth.getUser()
  const { data } = await serviceClient().from('team_members').select('role, display_name, teams(name)').eq('user_id', me!.id)
  expect(data).toEqual([{ role: 'admin', display_name: 'Bia Lima', teams: { name: 'Workspace de Bia' } }])
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
  expect(screen.queryByText('Crie seu workspace')).toBeNull()
})

it('a sign-in error from the browser goes away when the person asks for a code', async () => {
  const user = userEvent.setup()
  render(<App client={appClient()} />)
  await screen.findByRole('button', { name: 'Entrar com Google' })
  act(() => deepLink.deliver('sala://auth/callback?error=access_denied'))
  expect(screen.getByRole('alert').textContent).toBe('Não foi possível entrar. Tente de novo.')

  await user.type(screen.getByLabelText('E-mail'), `app-erro-${randomUUID()}@test.local`)
  await user.click(screen.getByRole('button', { name: 'Enviar código' }))
  expect(await screen.findByText(/^Enviamos um código de 6 dígitos/)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('a sign-in error does not come back after signing in and out', async () => {
  const client = appClient()
  render(<App client={client} />)
  await screen.findByRole('button', { name: 'Entrar com Google' })
  act(() => deepLink.deliver('sala://auth/callback?error=access_denied'))
  expect(screen.getByRole('alert')).toBeTruthy()

  // Signing in another way, here with the email code straight through the client.
  const email = `app-volta-${randomUUID()}@test.local`
  await sendLoginCode(client, email)
  await verifyLoginCode(client, email, await loginCode(email))
  expect(await screen.findByLabelText('Seu nome')).toBeTruthy()

  await act(async () => {
    await client.auth.signOut()
  })
  expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

/** A signed-in person with a name and a workspace of their own. */
async function personWithWorkspace(name: string) {
  const client = await signedIn(`app-${randomUUID()}@test.local`)
  await saveDisplayName(client, name)
  const teamId = await createWorkspace(client, `Workspace de ${name}`, name)
  const { data: { user } } = await client.auth.getUser()
  return { client, teamId, userId: user!.id }
}

it('a share link that arrives before sign-in opens after sign-in, in the workspace of the link', async () => {
  const email = `app-link-${randomUUID()}@test.local`
  const client = await signedIn(email)
  await saveDisplayName(client, 'Duda')
  await createWorkspace(client, 'Workspace de Duda', 'Duda')
  const { data: { user } } = await client.auth.getUser()
  const other = await createPieceFixture()
  const { error } = await serviceClient().from('team_members')
    .insert({ team_id: other.t.teamId, user_id: user!.id, role: 'espectador', display_name: 'Duda' })
  expect(error).toBeNull()
  await client.auth.signOut()

  render(<App client={client} />)
  await screen.findByRole('button', { name: 'Entrar com Google' })
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
  await screen.findByText('Workspace de Eva')
  act(() => deepLink.deliver(`sala://campanha/${mine.id}`))
  expect(await screen.findByRole('heading', { name: 'Campanha da Eva' })).toBeTruthy()

  act(() => deepLink.deliver(`sala://campanha/${other.campaignId}/peca/${other.pieceId}`))
  const notice = await screen.findByText('Peça não encontrada ou sem acesso.')
  // Announced to screen readers, and the campaign the person had open stays open.
  expect(screen.getByRole('alert').contains(notice)).toBe(true)
  expect(screen.getByRole('heading', { name: 'Campanha da Eva' })).toBeTruthy()

  await user.click(notice)
  expect(screen.queryByText('Peça não encontrada ou sem acesso.')).toBeNull()
  expect(screen.getByText('Workspace de Eva')).toBeTruthy()
})

it('opens the remembered workspace and creates a new one from the sidebar', async () => {
  const user = userEvent.setup()
  const { client, userId } = await personWithWorkspace('Fábio')
  const other = await createTestTeam('Agência Remota')
  await serviceClient().from('team_members').insert({ team_id: other.teamId, user_id: userId, role: 'designer', display_name: 'Fábio' })
  localStorage.setItem('sala.workspace', other.teamId)

  render(<App client={client} />)
  const select = (await screen.findByLabelText('Workspace')) as HTMLSelectElement
  expect(select.value).toBe(other.teamId)

  await user.click(screen.getByRole('button', { name: 'Novo workspace' }))
  await user.type(screen.getByLabelText('Nome do workspace'), 'Estúdio Fábio')
  await user.click(screen.getByRole('button', { name: 'Criar workspace' }))
  const { data } = await serviceClient().from('teams').select('id').eq('name', 'Estúdio Fábio').single()
  await waitFor(() => expect((screen.getByLabelText('Workspace') as HTMLSelectElement).value).toBe(data!.id))
  expect(localStorage.getItem('sala.workspace')).toBe(data!.id)
})
