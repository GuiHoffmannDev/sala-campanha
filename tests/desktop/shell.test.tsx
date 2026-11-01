// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Membership } from '../../packages/desktop/src/data/team.ts'
import type { Route } from '../../packages/desktop/src/lib/link.ts'
import { Shell } from '../../packages/desktop/src/ui/Shell.tsx'
import { createAgentVersion, createPieceFixture, createTestTeam, serviceClient } from '../helpers/supabase'

const copied = vi.hoisted(() => ({ texts: [] as string[] }))
vi.mock('../../packages/desktop/src/native.ts', () => ({
  copyText: async (text: string) => {
    copied.texts.push(text)
  },
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
