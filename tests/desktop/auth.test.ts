import { createHash, randomUUID } from 'node:crypto'
import type { User } from '@supabase/supabase-js'
import { createAppClient } from '../../packages/desktop/src/data/client.ts'
import {
  displayNameOf, finishOAuth, oauthUrl, saveDisplayName, sendLoginCode, verifyLoginCode, type OAuthProvider,
} from '../../packages/desktop/src/data/auth.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { acceptInvites, createWorkspace, loadMembers, loadMyMemberships } from '../../packages/desktop/src/data/team.ts'
import { parseAuthCallback } from '../../packages/desktop/src/lib/link.ts'
import { createTestTeam, env, loginCode, serviceClient } from '../helpers/supabase'

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@test.local`
const appClient = () => createAppClient(env.url, env.anonKey)

it('a new person signs up with an email code and creates a workspace', async () => {
  const email = newEmail('nova')
  const client = appClient()
  await expect(sendLoginCode(client, `  ${email.toUpperCase()} `)).resolves.toBeUndefined()

  await verifyLoginCode(client, email, ` ${await loginCode(email)} `)
  const { data: { session } } = await client.auth.getSession()
  expect(session?.user.email).toBe(email)
  expect(displayNameOf(session!.user)).toBeNull()

  await saveDisplayName(client, ' Nova Pessoa ')
  const { data: { user } } = await client.auth.getUser()
  expect(displayNameOf(user!)).toBe('Nova Pessoa')

  expect(await acceptInvites(client, 'Nova Pessoa')).toBe(0)
  const teamId = await createWorkspace(client, 'Workspace de Nova', 'Nova Pessoa')
  expect(await loadMyMemberships(client)).toEqual([
    { teamId, teamName: 'Workspace de Nova', role: 'admin', displayName: 'Nova Pessoa' },
  ])
})

it("an invited person joins the inviter's workspace on first login", async () => {
  const teamName = `Agência ${randomUUID()}`
  const a = await createTestTeam(teamName)
  const email = newEmail('convidada')
  const { error } = await a.members.admin.client.rpc('invite_member', { p_team: a.teamId, p_email: email, p_role: 'designer' })
  expect(error).toBeNull()

  const client = appClient()
  await sendLoginCode(client, email)
  await verifyLoginCode(client, email, await loginCode(email))
  expect(await acceptInvites(client, 'Convidada')).toBe(1)
  // Only the person's own membership, not the other members of the workspace.
  expect(await loadMyMemberships(client)).toEqual([
    { teamId: a.teamId, teamName, role: 'designer', displayName: 'Convidada' },
  ])
})

it('loadMyMemberships lists my workspaces by name', async () => {
  const email = newEmail('varios')
  const client = appClient()
  await sendLoginCode(client, email)
  await verifyLoginCode(client, email, await loginCode(email))
  await createWorkspace(client, 'Zeta', 'Ana')
  await createWorkspace(client, 'Ágata', 'Ana')
  await createWorkspace(client, 'Beta', 'Ana')
  expect((await loadMyMemberships(client)).map((m) => m.teamName)).toEqual(['Ágata', 'Beta', 'Zeta'])
})

it('loadMembers lists the people of the workspace by name', async () => {
  // createTestTeam names each member after its role and inserts them as admin, gestor, designer, espectador.
  const a = await createTestTeam()
  const members = await loadMembers(a.members.gestor.client, a.teamId)
  expect(members.map((m) => [m.displayName, m.role])).toEqual([
    ['admin', 'admin'], ['designer', 'designer'], ['espectador', 'espectador'], ['gestor', 'gestor'],
  ])
  expect(members[0]?.userId).toBe(a.members.admin.userId)
})

it('a wrong code is refused with a readable message', async () => {
  const email = newEmail('errado')
  const client = appClient()
  await sendLoginCode(client, email)
  const wrong = (await loginCode(email)) === '000000' ? '111111' : '000000'

  const error = await verifyLoginCode(client, email, wrong).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('Código inválido ou vencido. Peça um novo.')
  expect(friendlyError(error)).toBe('Código inválido ou vencido. Peça um novo.')
  expect((await client.auth.getSession()).data.session).toBeNull()
})

it('asking for another code too soon says to wait', async () => {
  const email = newEmail('pressa')
  const client = appClient()
  await sendLoginCode(client, email)
  // supabase/config.toml allows one email per address per second; the hosted default is a minute.
  await expect(sendLoginCode(client, email)).rejects.toThrow('Espere um minuto antes de pedir outro código.')
})

it('oauthUrl points to the provider through Supabase', async () => {
  const response = await fetch(`${env.url}/auth/v1/settings`, { headers: { apikey: env.anonKey } })
  const settings = (await response.json()) as { external: Record<string, boolean> }
  const result = await oauthUrl(appClient(), 'google').then(
    (url) => ({ url }),
    (e: unknown) => ({ error: friendlyError(e) }),
  )

  if (settings.external.google) {
    expect(result).toMatchObject({ url: expect.stringContaining('/auth/v1/authorize?provider=google') })
    expect(result).toMatchObject({ url: expect.stringContaining('redirect_to=sala%3A%2F%2Fauth%2Fcallback%3Fsb_flow_id%3D') })
    expect(result).toMatchObject({ url: expect.stringContaining('code_challenge=') })
  } else {
    expect(result).toEqual({ error: 'Esse jeito de entrar ainda não está disponível.' })
  }
})

it('a sign-in provider that is off in Supabase gives the friendly text', async () => {
  // GitHub stays off in supabase/config.toml, so it answers the way Google or Apple do when they are off.
  const error = await oauthUrl(appClient(), 'github' as OAuthProvider).catch((e: unknown) => e)
  expect(friendlyError(error)).toBe('Esse jeito de entrar ainda não está disponível.')
})

it('a code that did not come from the provider is refused with a readable message', async () => {
  const client = appClient()
  await oauthUrl(client, 'apple').catch(() => undefined) // stores the PKCE verifier, as a real sign-in does
  await expect(finishOAuth(client, randomUUID())).rejects.toThrow('Não foi possível entrar. Tente de novo.')
})

it("finishing Google or Apple uses that sign-in's own PKCE verifier", async () => {
  const client = appClient()
  // Straight through supabase-js, without oauthUrl's check, so the test does not depend on Google being on.
  const { data } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'sala://auth/callback', skipBrowserRedirect: true },
  })
  const started = new URL(data.url!)
  // An email code asked for afterwards starts a newer PKCE flow on the same client.
  await sendLoginCode(client, newEmail('pkce'))

  // The link Supabase sends back: this sign-in's redirect plus the code.
  const back = new URL(started.searchParams.get('redirect_to')!)
  back.searchParams.set('code', randomUUID())
  const { code, flowId } = parseAuthCallback(back.href) as { code: string; flowId?: string }
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  try {
    // The code is made up, so Supabase refuses it; what matters is the verifier sent with it.
    await expect(finishOAuth(client, code, flowId)).rejects.toThrow('Não foi possível entrar. Tente de novo.')
    const exchange = fetchSpy.mock.calls.find(([url]) => String(url).includes('grant_type=pkce'))
    const { code_verifier } = JSON.parse(String(exchange?.[1]?.body)) as { code_verifier: string }
    expect(createHash('sha256').update(code_verifier).digest('base64url')).toBe(started.searchParams.get('code_challenge'))
  } finally {
    fetchSpy.mockRestore()
  }
})

it('the redirect allow list accepts the callback with its flow id', async () => {
  const email = newEmail('retorno')
  const { error: createError } = await serviceClient().auth.admin.createUser({ email, email_confirm: true })
  expect(createError).toBeNull()
  const flowId = randomUUID().replaceAll('-', '')
  const { data, error } = await serviceClient().auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `sala://auth/callback?sb_flow_id=${flowId}` },
  })
  expect(error).toBeNull()

  // Supabase sends the browser to the redirect only when the allow list has it, and to the site URL otherwise.
  const response = await fetch(data.properties!.action_link, { redirect: 'manual' })
  expect(response.headers.get('location')).toMatch(new RegExp(`^sala://auth/callback\\?sb_flow_id=${flowId}[&#]`))
})

it('sign-in calls without a connection say so', async () => {
  // Nothing listens on port 9, so every request fails before reaching a server.
  const offline = createAppClient('http://127.0.0.1:9', 'anon')
  const offlineText = 'Sem conexão com o servidor. Tente de novo.'
  const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => friendlyError(e))

  expect(await errorOf(sendLoginCode(offline, 'ana@test.local'))).toBe(offlineText)
  expect(await errorOf(verifyLoginCode(offline, 'ana@test.local', '123456'))).toBe(offlineText)
  expect(await errorOf(oauthUrl(offline, 'google'))).toBe(offlineText)
  expect(await errorOf(finishOAuth(offline, randomUUID()))).toBe(offlineText)
})

it('displayNameOf prefers the saved name, then the name from Google or Apple', () => {
  const user = (user_metadata: Record<string, unknown>) => ({ user_metadata }) as unknown as User
  expect(displayNameOf(user({ display_name: ' Ana ', full_name: 'Ana Souza', name: 'Ana S' }))).toBe('Ana')
  expect(displayNameOf(user({ full_name: ' Ana Souza ', name: 'Ana S' }))).toBe('Ana Souza')
  expect(displayNameOf(user({ name: 'Ana S' }))).toBe('Ana S')
  expect(displayNameOf(user({ display_name: '   ', full_name: 'Ana Souza' }))).toBe('Ana Souza')
  // The server takes at most 80 characters, counted as code points; Google and Apple send names of any length.
  expect(Array.from(displayNameOf(user({ full_name: '😀'.repeat(90) }))!)).toHaveLength(80)
  expect(displayNameOf(user({ full_name: `${'a'.repeat(79)} Souza` }))).toBe('a'.repeat(79))
  expect(displayNameOf(user({ display_name: 42 }))).toBeNull()
  expect(displayNameOf(user({}))).toBeNull()
})
