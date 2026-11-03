// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { File as NodeFile } from 'node:buffer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Membership } from '../../packages/desktop/src/data/team.ts'
import type { Route } from '../../packages/desktop/src/lib/link.ts'
import { Shell } from '../../packages/desktop/src/ui/Shell.tsx'
import { addReference, loadReferences } from '../../packages/desktop/src/data/references.ts'
import { createAgentVersion, createPieceFixture, createTestTeam, serviceClient } from '../helpers/supabase'

const copied = vi.hoisted(() => ({ texts: [] as string[] }))
vi.mock('../../packages/desktop/src/native.ts', () => ({
  copyText: async (text: string) => {
    copied.texts.push(text)
  },
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

beforeEach(() => {
  copied.texts = []
})

/** The Shell inside a tiny host that keeps the route, as the App does. */
function Host(props: {
  client: SupabaseClient; memberships: Membership[]; teamId: string; route?: Route
  onSwitchWorkspace?: (teamId: string) => void; onCreateWorkspace?: (name: string) => Promise<void>
}) {
  const [route, setRoute] = useState<Route>(props.route ?? { campaignId: null, pieceId: null })
  return (
    <Shell
      client={props.client} memberships={props.memberships} teamId={props.teamId} route={route} onNavigate={setRoute}
      onSwitchWorkspace={props.onSwitchWorkspace ?? (() => {})} onCreateWorkspace={props.onCreateWorkspace ?? (async () => {})}
    />
  )
}

const membership = (teamId: string, role: Membership['role'], teamName = 'Agência'): Membership =>
  ({ teamId, teamName, role, displayName: role })

it('posts the inherited model and campaign references through the piece composer', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const client = f.t.members.designer.client
  const { error: keyError } = await f.t.members.admin.client.rpc('set_provider_key', {
    p_team: f.t.teamId, p_provider: 'openai', p_key: 'local-test-key-for-task-eight',
  })
  expect(keyError).toBeNull()
  await client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Pedido anterior',
    p_model: { text: { provider: 'openai', model: 'gpt-6-astra', effort: 'high' } } })
  const reference = await addReference(client, { teamId: f.t.teamId, campaignId: f.campaignId,
    file: new NodeFile(['png'], 'Produto.png', { type: 'image/png' }) as File })
  render(<Host client={client} memberships={[membership(f.t.teamId, 'designer')]} teamId={f.t.teamId}
    route={{ campaignId: f.campaignId, pieceId: f.pieceId }} />)
  const input = await screen.findByRole('textbox', { name: 'Mensagem' })
  await waitFor(() => expect(screen.getByLabelText('Esforço de texto')).toHaveProperty('value', 'high'))
  await user.type(input, 'Gere outra versão')
  await user.click(screen.getByRole('button', { name: 'Anexar referência' }))
  await user.click(await screen.findByRole('checkbox', { name: 'Produto.png' }))
  await user.click(screen.getByRole('button', { name: 'Usar selecionadas' }))
  await user.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(async () => {
    const { data, error } = await client.from('session_events').select('body, to_agent, delivery')
      .eq('piece_id', f.pieceId).order('id', { ascending: false }).limit(1).single()
    expect(error).toBeNull()
    expect(data).toEqual({ body: { text: 'Gere outra versão', model: { text: {
      provider: 'openai', model: 'gpt-6-astra', effort: 'high',
    } }, reference_asset_ids: [reference.id] }, to_agent: true, delivery: 'queued' })
  })
})

it('shows an espectador notice instead of the composer', async () => {
  const f = await createPieceFixture()
  render(<Host client={f.t.members.espectador.client} memberships={[membership(f.t.teamId, 'espectador')]}
    teamId={f.t.teamId} route={{ campaignId: f.campaignId, pieceId: f.pieceId }} />)
  expect(await screen.findByText('Você acompanha esta peça como espectador.')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Mensagem' })).toBeNull()
})

it('opens campaign references for an espectador and returns to the piece', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  await addReference(f.t.members.designer.client, {
    teamId: f.t.teamId, campaignId: f.campaignId,
    file: new NodeFile(['png'], 'Produto.png', { type: 'image/png' }) as File,
  })
  render(<Host client={f.t.members.espectador.client} memberships={[membership(f.t.teamId, 'espectador')]}
    teamId={f.t.teamId} route={{ campaignId: f.campaignId, pieceId: f.pieceId }} />)
  await user.click(await screen.findByRole('button', { name: 'Referências' }))
  const image = await screen.findByRole('img', { name: 'Produto.png' })
  expect(image.getAttribute('src')).toContain('/storage/v1/object/sign/team-files/')
  expect(screen.queryByLabelText('Enviar fotos')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Voltar à peça' }))
  expect(await screen.findByRole('list', { name: 'Conversa' })).toBeTruthy()
})

it('a designer uploads multiple campaign photos and a campaign switch hides them', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const memberships = [membership(f.t.teamId, 'designer')]
  const props = { client: f.t.members.designer.client, memberships, teamId: f.t.teamId,
    onNavigate: () => {}, onSwitchWorkspace: () => {}, onCreateWorkspace: async () => {} }
  const { rerender } = render(<Shell {...props} route={{ campaignId: f.campaignId, pieceId: null }} />)
  await user.click(await screen.findByRole('button', { name: 'Referências' }))
  // Use Node Files at the fetch boundary: jsdom's File is not a native Node Blob.
  fireEvent.change(screen.getByLabelText('Enviar fotos'), { target: { files: [
    new NodeFile(['png'], 'Produto.png', { type: 'image/png' }),
    new NodeFile(['jpg'], 'Detalhe.jpg', { type: 'image/jpeg' }),
  ] } })
  expect(await screen.findByRole('img', { name: 'Produto.png' })).toBeTruthy()
  expect(await screen.findByRole('img', { name: 'Detalhe.jpg' })).toBeTruthy()
  expect(await loadReferences(f.t.members.espectador.client, f.campaignId)).toHaveLength(2)

  rerender(<Shell {...props} route={{ campaignId: other.campaignId, pieceId: null }} />)
  expect(screen.queryByRole('img', { name: 'Produto.png' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Referências' }))
  expect(await screen.findByText('Nenhuma referência nesta campanha.')).toBeTruthy()
  expect(screen.queryByRole('img', { name: 'Detalhe.jpg' })).toBeNull()
})

it('opening a piece from the list closes the reference library', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  render(<Host client={f.t.members.designer.client} memberships={[membership(f.t.teamId, 'designer')]}
    teamId={f.t.teamId} route={{ campaignId: f.campaignId, pieceId: null }} />)
  await user.click(await screen.findByRole('button', { name: 'Referências' }))
  const pieces = screen.getByRole('region', { name: 'Peças da campanha' })
  await user.click(await within(pieces).findByRole('button', { name: /Peça de teste/ }))
  expect(await screen.findByLabelText('Título da peça')).toHaveProperty('value', 'Peça de teste')
  expect(screen.queryByRole('region', { name: 'Biblioteca de referências' })).toBeNull()
  expect(screen.getByRole('list', { name: 'Conversa' })).toBeTruthy()
})

it('a designer creates a campaign and a piece, opens it and copies its link', async () => {
  const user = userEvent.setup()
  const t = await createTestTeam()
  render(<Host client={t.members.designer.client} memberships={[membership(t.teamId, 'designer')]} teamId={t.teamId} />)

  await user.click(await screen.findByRole('button', { name: 'Nova campanha' }))
  await user.type(screen.getByLabelText('Nome da campanha'), 'Black Friday')
  await user.click(screen.getByRole('button', { name: 'Criar campanha' }))
  // The new campaign opens: its name is in the header.
  expect(await screen.findByRole('heading', { name: 'Black Friday' })).toBeTruthy()
  expect(screen.getByText('Escolha uma peça')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Nova peça' }))
  await user.type(screen.getByLabelText('Título da peça'), 'Banner Instagram')
  await user.selectOptions(screen.getByLabelText('Tipo'), 'Imagem e texto')
  await user.click(screen.getByRole('button', { name: 'Criar peça' }))

  const list = screen.getByRole('region', { name: 'Peças da campanha' })
  expect(await within(list).findByText('Banner Instagram')).toBeTruthy()
  expect(within(list).getByText('Imagem e texto')).toBeTruthy()
  expect(within(list).getByText('Gerando')).toBeTruthy()
  // The new piece opens too: its title is editable in the header.
  const title = (await screen.findByLabelText('Título da peça')) as HTMLInputElement
  expect(title.value).toBe('Banner Instagram')

  const { data: piece } = await serviceClient().from('pieces').select('id, campaign_id').eq('team_id', t.teamId).single()
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }))
  expect(await screen.findByText('Link copiado')).toBeTruthy()
  expect(copied.texts).toEqual([`sala://campanha/${piece!.campaign_id}/peca/${piece!.id}`])
})

it('renames the open piece in the header', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  render(
    <Host
      client={f.t.members.designer.client} memberships={[membership(f.t.teamId, 'designer')]} teamId={f.t.teamId}
      route={{ campaignId: f.campaignId, pieceId: f.pieceId }}
    />,
  )

  const title = (await screen.findByLabelText('Título da peça')) as HTMLInputElement
  await waitFor(() => expect(title.value).toBe('Peça de teste'))
  await user.clear(title)
  await user.type(title, 'Post do Natal{Enter}')
  await waitFor(async () => {
    const { data } = await serviceClient().from('pieces').select('title').eq('id', f.pieceId).single()
    expect(data?.title).toBe('Post do Natal')
  })
})

it('an espectador sees the work and the people but cannot create or rename', async () => {
  const f = await createPieceFixture(undefined, 'imagem')
  await createAgentVersion(f, { caption: null })
  render(
    <Host
      client={f.t.members.espectador.client} memberships={[membership(f.t.teamId, 'espectador', 'Agência Sol')]}
      teamId={f.t.teamId} route={{ campaignId: f.campaignId, pieceId: f.pieceId }}
    />,
  )

  expect(await screen.findByRole('heading', { name: 'Peça de teste' })).toBeTruthy()
  expect(screen.getByText('Agência Sol')).toBeTruthy()
  const list = screen.getByRole('region', { name: 'Peças da campanha' })
  expect(within(list).getByText('Base em revisão')).toBeTruthy()
  // The thumbnail is the newest image, through a signed URL. It is decorative (alt=""): the title is beside it.
  const thumbnail = await waitFor(() => {
    const img = list.querySelector('img')
    if (!img) throw new Error('no thumbnail yet')
    return img
  })
  expect(thumbnail.src).toContain('/storage/v1/object/sign/team-files/')

  const people = screen.getByRole('region', { name: 'Pessoas do workspace' })
  expect(await within(people).findAllByRole('listitem')).toHaveLength(4)
  // The test helper names each person after their role: name and role both show.
  expect(within(people).getAllByText('gestor')).toHaveLength(2)

  expect(screen.queryByRole('button', { name: 'Nova campanha' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Nova peça' })).toBeNull()
  expect(screen.queryByLabelText('Título da peça')).toBeNull()
  expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeTruthy()
})

it("a workspace switch never shows the previous workspace's campaigns", async () => {
  const f = await createPieceFixture()
  const b = await createTestTeam()
  const client = f.t.members.designer.client
  const memberships = [membership(f.t.teamId, 'designer', 'Agência A'), membership(b.teamId, 'designer', 'Agência B')]
  const { rerender } = render(<Host client={client} memberships={memberships} teamId={f.t.teamId} />)
  expect(await screen.findByRole('button', { name: 'Campanha de teste' })).toBeTruthy()

  // Checked right after the switch, before the new workspace's lists load.
  rerender(<Host client={client} memberships={memberships} teamId={b.teamId} />)
  expect(screen.queryByRole('button', { name: 'Campanha de teste' })).toBeNull()
})

it('switches between workspaces and creates a new one', async () => {
  const user = userEvent.setup()
  const a = await createTestTeam()
  const b = await createTestTeam()
  const switched: string[] = []
  const created: string[] = []
  render(
    <Host
      client={a.members.designer.client} teamId={a.teamId}
      memberships={[membership(a.teamId, 'designer', 'Agência A'), membership(b.teamId, 'espectador', 'Agência B')]}
      onSwitchWorkspace={(id) => switched.push(id)} onCreateWorkspace={async (name) => { created.push(name) }}
    />,
  )

  await user.selectOptions(await screen.findByLabelText('Workspace'), 'Agência B')
  expect(switched).toEqual([b.teamId])

  await user.click(screen.getByRole('button', { name: 'Novo workspace' }))
  await user.type(screen.getByLabelText('Nome do workspace'), 'Agência C')
  await user.click(screen.getByRole('button', { name: 'Criar workspace' }))
  await waitFor(() => expect(created).toEqual(['Agência C']))
})
