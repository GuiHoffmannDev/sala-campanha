import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { joinTeamPresence } from '../../packages/desktop/src/data/presence.ts'
import { subscribeMentions } from '../../packages/desktop/src/data/events.ts'
import { onlineUsers, usersInPiece, type PresenceMeta } from '../../packages/desktop/src/lib/presence.ts'
import { closeChannels, waitFor, warmUpRealtime } from '../helpers/realtime'
import { createPieceFixture, createTestTeam } from '../helpers/supabase'

beforeAll(warmUpRealtime, 40_000)
afterEach(closeChannels)

it('team members see each other online and in the same piece', async () => {
  const f = await createPieceFixture()
  const a = f.t.members.designer
  const b = f.t.members.gestor
  let aState: Record<string, PresenceMeta[]> = {}
  let bState: Record<string, PresenceMeta[]> = {}
  const first = await joinTeamPresence(a.client, f.t.teamId,
    { user_id: a.userId, piece_id: f.pieceId }, (state) => { aState = state })
  const second = await joinTeamPresence(b.client, f.t.teamId,
    { user_id: b.userId, piece_id: null }, (state) => { bState = state })
  try {
    await waitFor(() => onlineUsers(aState).size === 2 && onlineUsers(bState).size === 2)
    expect(onlineUsers(aState)).toEqual(new Set([a.userId, b.userId]))
    expect(onlineUsers(bState)).toEqual(new Set([a.userId, b.userId]))
    expect(usersInPiece(aState, f.pieceId)).toEqual([a.userId])
    await second.setPiece(f.pieceId)
    await waitFor(() => usersInPiece(aState, f.pieceId).length === 2)
    expect(new Set(usersInPiece(aState, f.pieceId))).toEqual(new Set([a.userId, b.userId]))
    await second.setPiece(null)
    await waitFor(() => usersInPiece(aState, f.pieceId).length === 1)
    expect(usersInPiece(aState, f.pieceId)).toEqual([a.userId])
    await second.leave()
    await waitFor(() => onlineUsers(aState).size === 1)
    expect(onlineUsers(aState)).toEqual(new Set([a.userId]))
    expect(b.client.getChannels()).toHaveLength(0)
  } finally {
    await first.leave()
    await second.leave()
  }
})

it('presence rejects another team and releases the denied channel', async () => {
  const a = await createTestTeam()
  const b = await createTestTeam()
  await expect(joinTeamPresence(b.members.designer.client, a.teamId,
    { user_id: b.members.designer.userId, piece_id: null }, () => {})).rejects.toThrow()
  expect(b.members.designer.client.getChannels()).toHaveLength(0)
})

it('presence restores the latest piece after a dropped socket', async () => {
  const f = await createPieceFixture()
  const a = f.t.members.designer
  const b = f.t.members.gestor
  let state: Record<string, PresenceMeta[]> = {}
  const observer = await joinTeamPresence(a.client, f.t.teamId,
    { user_id: a.userId, piece_id: null }, (next) => { state = next })
  const moving = await joinTeamPresence(b.client, f.t.teamId,
    { user_id: b.userId, piece_id: null }, () => {})
  try {
    const socket = (b.client.realtime as unknown as { socketAdapter: { getSocket(): { conn: WebSocket } } })
      .socketAdapter.getSocket()
    socket.conn.close()
    await waitFor(() => b.client.getChannels()[0]?.state !== 'joined')
    await moving.setPiece(f.pieceId)
    await waitFor(() => usersInPiece(state, f.pieceId).includes(b.userId))
    expect(usersInPiece(state, f.pieceId)).toEqual([b.userId])
  } finally {
    await moving.leave()
    await observer.leave()
  }
})

it('subscribeMentions receives events across pieces of its team only and stops on cleanup', async () => {
  const f = await createPieceFixture()
  const otherPiece = await createPieceFixture(f.t)
  const otherTeam = await createPieceFixture()
  const me = f.t.members.designer
  await me.client.realtime.setAuth()
  const events: SessionEvent[] = []
  const stop = subscribeMentions(me.client, f.t.teamId, (event) => events.push(event))
  try {
    await waitFor(() => me.client.getChannels().some((c) => c.state === 'joined'))
    for (const fixture of [f, otherPiece, otherTeam]) {
      const { error } = await fixture.t.members.gestor.client.rpc('post_message', {
        p_piece: fixture.pieceId, p_text: '@designer Confira', p_mention_user_ids: [fixture.t.members.designer.userId],
      })
      expect(error).toBeNull()
    }
    await waitFor(() => events.length >= 2)
    expect(events.map((e) => e.piece_id).sort()).toEqual([f.pieceId, otherPiece.pieceId].sort())
    stop()
    await waitFor(() => me.client.getChannels().length === 0)
    expect(me.client.getChannels()).toHaveLength(0)
    await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Depois' })
    await waitFor(() => false)
    expect(events).toHaveLength(2)
  } finally { stop(); await me.client.removeAllChannels() }
})
