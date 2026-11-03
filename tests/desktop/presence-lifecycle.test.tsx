// @vitest-environment jsdom
import type { SupabaseClient } from '@supabase/supabase-js'
import { render, waitFor } from '@testing-library/react'
import { Shell } from '../../packages/desktop/src/ui/Shell.tsx'

vi.mock('../../packages/desktop/src/data/team.ts', () => ({ loadMembers: async () => [] }))
vi.mock('../../packages/desktop/src/data/campaigns.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/campaigns.ts')>()),
  loadCampaigns: async () => [],
  subscribeLists: () => () => {},
}))
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/events.ts')>()),
  subscribeMentions: () => () => {},
}))

it('leaves a pending offline join before joining another workspace and on unmount', async () => {
  const channels = new Map<string, {
    on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; track: ReturnType<typeof vi.fn>
  }>()
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } }, error: null }) },
    realtime: { setAuth: async () => {} },
    channel: vi.fn((topic: string) => {
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), track: vi.fn() }
      channels.set(topic, channel)
      return channel
    }),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  }
  const props = {
    client: client as unknown as SupabaseClient,
    memberships: ['a', 'b'].map((teamId) => ({ teamId, teamName: teamId, role: 'designer' as const, displayName: 'Me' })),
    route: { campaignId: null, pieceId: null },
    onNavigate: () => {}, onSwitchWorkspace: () => {}, onCreateWorkspace: async () => {},
  }
  const view = render(<Shell {...props} teamId="a" />)
  await waitFor(() => expect(channels.has('team:a')).toBe(true))
  const first = channels.get('team:a')!
  const status = first.subscribe.mock.calls[0]![0] as (state: string, error?: Error) => void
  status('CHANNEL_ERROR', new Error('socket closed'))
  view.rerender(<Shell {...props} teamId="b" />)
  await waitFor(() => expect(channels.has('team:b')).toBe(true))
  expect(client.removeChannel).toHaveBeenCalledWith(first)
  status('SUBSCRIBED')
  expect(first.track).not.toHaveBeenCalled()
  view.unmount()
  await waitFor(() => expect(client.removeChannel).toHaveBeenCalledWith(channels.get('team:b')))
})
