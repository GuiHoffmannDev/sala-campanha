import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { subscribeMentions } from '../../packages/desktop/src/data/events.ts'
import { shouldNotify } from '../../packages/desktop/src/lib/presence.ts'
import { closeChannels, listen, waitFor, warmUpRealtime } from '../helpers/realtime'
import { createPieceFixture, serviceClient } from '../helpers/supabase'

beforeAll(warmUpRealtime, 40_000)
afterEach(closeChannels)

it('recovers offline mentions once, without old history or another accessible workspace', async () => {
  const first = await createPieceFixture()
  const secondPiece = await createPieceFixture(first.t)
  const otherTeam = await createPieceFixture()
  const me = first.t.members.designer
  const membership = await serviceClient().from('team_members').insert({
    team_id: otherTeam.t.teamId, user_id: me.userId, role: 'designer', display_name: 'designer',
  })
  expect(membership.error).toBeNull()

  const post = async (fixture: typeof first, mentions: string[], self = false) => {
    const author = self ? me : fixture.t.members.gestor
    const { data, error } = await author.client.rpc('post_message', {
      p_piece: fixture.pieceId, p_text: '@designer Confira', p_mention_user_ids: mentions,
    })
    expect(error).toBeNull()
    return data.id as number
  }
  await post(first, [me.userId])
  // Let the old INSERT pass through replication before opening the live subscription.
  await waitFor(() => true)
  const observed = await listen(first.t.members.gestor.client, [
    { table: 'session_events', filter: `team_id=eq.${first.t.teamId}` },
  ])

  await me.client.realtime.setAuth()
  const received: SessionEvent[] = []
  const notices: SessionEvent[] = []
  const stop = subscribeMentions(me.client, first.t.teamId, (event) => {
    received.push(event)
    if (shouldNotify(event, me.userId)) notices.push(event)
  })
  try {
    const joined = () => me.client.getChannels().some((channel) => channel.state === 'joined')
    await waitFor(joined)
    expect(joined()).toBe(true)
    expect(notices).toEqual([])

    await me.client.realtime.disconnect()
    expect(me.client.realtime.isConnected()).toBe(false)
    await waitFor(() => !joined())
    expect(joined()).toBe(false)
    const missed = await post(secondPiece, [me.userId])
    await post(first, [me.userId], true)
    await post(first, [])
    await post(otherTeam, [me.userId])
    // The observer proves replication processed the missing INSERT while this client was offline.
    const replicated = () => observed.some((change) => 'id' in change.new && change.new.id === missed)
    await waitFor(replicated)
    expect(replicated()).toBe(true)
    expect(notices).toEqual([])

    me.client.realtime.connect()
    await waitFor(() => notices.some((event) => event.id === missed))
    expect(notices.map((event) => event.id)).toEqual([missed])
    expect(received.every((event) => event.team_id === first.t.teamId)).toBe(true)
    expect(new Set(received.map((event) => event.id)).size).toBe(received.length)

    await me.client.realtime.disconnect()
    me.client.realtime.connect()
    await waitFor(joined)
    expect(notices.map((event) => event.id)).toEqual([missed])
    stop()
    const count = received.length
    await post(first, [me.userId])
    await waitFor(() => me.client.getChannels().length === 0)
    expect(received).toHaveLength(count)
  } finally {
    stop()
    await me.client.removeAllChannels()
  }
})
