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
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(screen.getByLabelText('Text effort')).toHaveProperty('value', 'high'))
  await user.type(input, 'Gere outra versão')
  await user.click(screen.getByRole('button', { name: 'Attach reference' }))
  await user.click(await screen.findByRole('checkbox', { name: 'Produto.png' }))
  await user.click(screen.getByRole('button', { name: 'Use selected' }))
  await user.click(screen.getByRole('button', { name: 'Send' }))
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
  expect(await screen.findByText('You are viewing this piece as a viewer.')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
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
  await user.click(await screen.findByRole('button', { name: 'References' }))
  const image = await screen.findByRole('img', { name: 'Produto.png' })
  expect(image.getAttribute('src')).toContain('/storage/v1/object/sign/team-files/')
  expect(screen.queryByLabelText('Upload photos')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Back to piece' }))
  expect(await screen.findByRole('list', { name: 'Conversation' })).toBeTruthy()
})

it('a designer uploads multiple campaign photos and a campaign switch hides them', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const memberships = [membership(f.t.teamId, 'designer')]
  const props = { client: f.t.members.designer.client, memberships, teamId: f.t.teamId,
    onNavigate: () => {}, onSwitchWorkspace: () => {}, onCreateWorkspace: async () => {} }
  const { rerender } = render(<Shell {...props} route={{ campaignId: f.campaignId, pieceId: null }} />)
  await user.click(await screen.findByRole('button', { name: 'References' }))
  // Use Node Files at the fetch boundary: jsdom's File is not a native Node Blob.
  fireEvent.change(screen.getByLabelText('Upload photos'), { target: { files: [
    new NodeFile(['png'], 'Produto.png', { type: 'image/png' }),
    new NodeFile(['jpg'], 'Detalhe.jpg', { type: 'image/jpeg' }),
  ] } })
  expect(await screen.findByRole('img', { name: 'Produto.png' })).toBeTruthy()
  expect(await screen.findByRole('img', { name: 'Detalhe.jpg' })).toBeTruthy()
  expect(await loadReferences(f.t.members.espectador.client, f.campaignId)).toHaveLength(2)

  rerender(<Shell {...props} route={{ campaignId: other.campaignId, pieceId: null }} />)
  expect(screen.queryByRole('img', { name: 'Produto.png' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'References' }))
  expect(await screen.findByText('No references in this campaign.')).toBeTruthy()
  expect(screen.queryByRole('img', { name: 'Detalhe.jpg' })).toBeNull()
})

it('opening a piece from the list closes the reference library', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  render(<Host client={f.t.members.designer.client} memberships={[membership(f.t.teamId, 'designer')]}
    teamId={f.t.teamId} route={{ campaignId: f.campaignId, pieceId: null }} />)
  await user.click(await screen.findByRole('button', { name: 'References' }))
  const pieces = screen.getByRole('region', { name: 'Campaign pieces' })
  await user.click(await within(pieces).findByRole('button', { name: /Peça de teste/ }))
  expect(await screen.findByLabelText('Piece title')).toHaveProperty('value', 'Peça de teste')
  expect(screen.queryByRole('region', { name: 'Reference library' })).toBeNull()
  expect(screen.getByRole('list', { name: 'Conversation' })).toBeTruthy()
})

it('a designer creates a campaign and a piece, opens it and copies its link', async () => {
  const user = userEvent.setup()
  const t = await createTestTeam()
  render(<Host client={t.members.designer.client} memberships={[membership(t.teamId, 'designer')]} teamId={t.teamId} />)

  await user.click(await screen.findByRole('button', { name: 'New campaign' }))
  await user.type(screen.getByLabelText('Campaign name'), 'Black Friday')
  await user.click(screen.getByRole('button', { name: 'Create campaign' }))
  // The new campaign opens: its name is in the header.
  expect(await screen.findByRole('heading', { name: 'Black Friday' })).toBeTruthy()
  expect(screen.getByText('Choose a piece')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'New piece' }))
  await user.type(screen.getByLabelText('Piece title'), 'Banner Instagram')
  await user.selectOptions(screen.getByLabelText('Type'), 'Image and text')
  await user.click(screen.getByRole('button', { name: 'Create piece' }))

  const list = screen.getByRole('region', { name: 'Campaign pieces' })
  expect(await within(list).findByText('Banner Instagram')).toBeTruthy()
  expect(within(list).getByText('Image and text')).toBeTruthy()
  expect(within(list).getByText('Generating')).toBeTruthy()
  // The new piece opens too: its title is editable in the header.
  const title = (await screen.findByLabelText('Piece title')) as HTMLInputElement
  expect(title.value).toBe('Banner Instagram')

  const { data: piece } = await serviceClient().from('pieces').select('id, campaign_id').eq('team_id', t.teamId).single()
  await user.click(screen.getByRole('button', { name: 'Share' }))
  expect(await screen.findByText('Link copied')).toBeTruthy()
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

  const title = (await screen.findByLabelText('Piece title')) as HTMLInputElement
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
  const list = screen.getByRole('region', { name: 'Campaign pieces' })
  expect(within(list).getByText('Base under review')).toBeTruthy()
  // The thumbnail is the newest image, through a signed URL. It is decorative (alt=""): the title is beside it.
  const thumbnail = await waitFor(() => {
    const img = list.querySelector('img')
    if (!img) throw new Error('no thumbnail yet')
    return img
  })
  expect(thumbnail.src).toContain('/storage/v1/object/sign/team-files/')

  const people = screen.getByRole('region', { name: 'Workspace members' })
  expect(await within(people).findAllByRole('listitem')).toHaveLength(4)
  // The fixture name stays in Portuguese; the role label is product copy in English.
  expect(within(people).getByText('gestor')).toBeTruthy()
  expect(within(people).getByText('Manager')).toBeTruthy()

  expect(screen.queryByRole('button', { name: 'New campaign' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'New piece' })).toBeNull()
  expect(screen.queryByLabelText('Piece title')).toBeNull()
  expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
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

  await user.click(screen.getByRole('button', { name: 'New workspace' }))
  await user.type(screen.getByLabelText('Workspace name'), 'Agência C')
  await user.click(screen.getByRole('button', { name: 'Create workspace' }))
  await waitFor(() => expect(created).toEqual(['Agência C']))
})

it('an admin opens workspace settings and saving a key refreshes its mask', async () => {
  const user = userEvent.setup()
  const t = await createTestTeam()
  render(<Host client={t.members.admin.client} teamId={t.teamId} memberships={[membership(t.teamId, 'admin')]} />)
  await user.click(screen.getByRole('button', { name: 'Workspace settings' }))
  const field = await screen.findByLabelText('Key Anthropic')
  await user.type(field, 'chave-falsa-local-0001')
  await user.click(within(screen.getByRole('region', { name: 'Anthropic' })).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('...0001')).toBeTruthy()
  expect(field).toHaveProperty('value', '')
  await user.click(screen.getByRole('button', { name: 'Back to campaigns' }))
  expect(screen.queryByLabelText('Key Anthropic')).toBeNull()
})

it.each(['gestor', 'designer', 'espectador'] as const)('%s cannot open workspace settings', async (role) => {
  const t = await createTestTeam()
  render(<Host client={t.members[role].client} teamId={t.teamId} memberships={[membership(t.teamId, role)]} />)
  expect(await screen.findByRole('heading', { name: 'Agência' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Workspace settings' })).toBeNull()
})

it('switching workspaces closes settings and clears the typed key', async () => {
  const user = userEvent.setup()
  const a = await createTestTeam()
  const b = await createTestTeam()
  const props = { client: a.members.admin.client, memberships: [membership(a.teamId, 'admin'), membership(b.teamId, 'admin')],
    route: { campaignId: null, pieceId: null }, onNavigate: () => {}, onSwitchWorkspace: () => {}, onCreateWorkspace: async () => {} }
  const { rerender } = render(<Shell {...props} teamId={a.teamId} />)
  await user.click(screen.getByRole('button', { name: 'Workspace settings' }))
  await user.type(await screen.findByLabelText('Key Anthropic'), 'pending-secret')
  rerender(<Shell {...props} teamId={b.teamId} />)
  expect(screen.queryByLabelText('Key Anthropic')).toBeNull()
})
