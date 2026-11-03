// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionEvent } from '../../packages/shared/src/events.ts'
import type { PresenceMeta } from '../../packages/desktop/src/lib/presence.ts'
import { Shell } from '../../packages/desktop/src/ui/Shell.tsx'
import { createPieceFixture } from '../helpers/supabase'

// Native notifications and sockets are external boundaries. Node's sockets reject jsdom events.
const live = vi.hoisted(() => ({
  sync: null as null | ((state: Record<string, PresenceMeta[]>) => void),
  event: null as null | ((event: SessionEvent) => void),
  location: null as string | null,
  left: false, stopped: false,
  notifications: [] as { title: string; body: string }[],
}))
vi.mock('../../packages/desktop/src/native.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/native.ts')>()),
  notify: async (title: string, body: string) => { live.notifications.push({ title, body }) },
}))
vi.mock('../../packages/desktop/src/data/presence.ts', () => ({
  joinTeamPresence: async (_client: unknown, _team: string, me: PresenceMeta, sync: typeof live.sync) => {
    live.sync = sync
    live.location = me.piece_id
    return {
      setPiece: async (pieceId: string | null) => { live.location = pieceId },
      leave: async () => { live.left = true },
    }
  },
}))
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/events.ts')>()),
  subscribePiece: () => () => {},
  subscribeMentions: (_client: unknown, _team: string, callback: typeof live.event) => {
    live.event = callback
    return () => { live.stopped = true }
  },
}))
vi.mock('../../packages/desktop/src/data/campaigns.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/campaigns.ts')>()),
  subscribeLists: () => () => {},
}))

beforeEach(() => {
  live.sync = null; live.event = null; live.left = false; live.stopped = false; live.notifications = []
})

it('shows online people and unique piece avatars, updates location and leaves on unmount', async () => {
  const f = await createPieceFixture()
  const designer = f.t.members.designer
  const gestor = f.t.members.gestor
  const props = { client: designer.client, teamId: f.t.teamId,
    memberships: [{ teamId: f.t.teamId, teamName: 'Agência', role: 'designer' as const, displayName: 'designer' }],
    onNavigate: () => {}, onSwitchWorkspace: () => {}, onCreateWorkspace: async () => {} }
  const view = render(<Shell {...props} route={{ campaignId: f.campaignId, pieceId: f.pieceId }} />)
  await waitFor(() => expect(live.sync).not.toBeNull())
  expect(live.location).toBe(f.pieceId)
  await act(async () => live.sync!({
    designer: [{ user_id: designer.userId, piece_id: f.pieceId }, { user_id: designer.userId, piece_id: f.pieceId }],
    gestor: [{ user_id: gestor.userId, piece_id: null }],
  }))
  const people = await screen.findByRole('region', { name: 'Pessoas do workspace' })
  expect(await within(people).findByLabelText('designer: online')).toBeTruthy()
  expect(within(people).getByLabelText('gestor: online')).toBeTruthy()
  expect(within(people).getByLabelText('admin: offline')).toBeTruthy()
  const avatars = await screen.findByRole('group', { name: 'Nesta peça' })
  expect(within(avatars).getAllByRole('img')).toHaveLength(1)
  expect(within(avatars).getByRole('img', { name: 'designer' }).textContent).toBe('D')
  view.rerender(<Shell {...props} route={{ campaignId: f.campaignId, pieceId: null }} />)
  await waitFor(() => expect(live.location).toBeNull())
  expect(screen.queryByRole('group', { name: 'Nesta peça' })).toBeNull()
  view.unmount()
  await waitFor(() => expect(live.left).toBe(true))
  expect(live.stopped).toBe(true)
})

it('notifies mentions from another piece with its title and author, ignoring self and other events', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  await f.t.members.designer.client.from('pieces').update({ title: 'Outro banner' }).eq('id', other.pieceId)
  const me = f.t.members.designer
  const view = render(<Shell client={me.client} teamId={f.t.teamId}
    memberships={[{ teamId: f.t.teamId, teamName: 'Agência', role: 'designer', displayName: 'designer' }]}
    route={{ campaignId: f.campaignId, pieceId: f.pieceId }} onNavigate={() => {}}
    onSwitchWorkspace={() => {}} onCreateWorkspace={async () => {}} />)
  await screen.findByRole('region', { name: 'Pessoas do workspace' })
  await screen.findAllByText('gestor')
  await waitFor(() => expect(live.event).not.toBeNull())
  const event: SessionEvent = { id: 42, team_id: f.t.teamId, piece_id: other.pieceId,
    author_id: f.t.members.gestor.userId, kind: 'user_message',
    body: { text: '@designer Veja', model: null, reference_asset_ids: [] }, mention_user_ids: [me.userId],
    to_agent: false, delivery: 'not_applicable', created_at: '2026-11-03T12:00:00Z' }
  await act(async () => {
    live.event!({ ...event, author_id: me.userId })
    live.event!({ ...event, mention_user_ids: [] })
    live.event!(event)
    live.event!(event)
  })
  await waitFor(() => expect(live.notifications).toEqual([
    { title: 'gestor mencionou você', body: 'Outro banner: @designer Veja' },
  ]))
  view.unmount()
  await act(async () => live.event!(event))
  expect(live.notifications).toHaveLength(1)
})
