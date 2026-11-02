import type { SupabaseClient } from '@supabase/supabase-js'
import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { renamePiece } from '../../packages/desktop/src/data/campaigns.ts'
import { loadEvents, subscribePiece } from '../../packages/desktop/src/data/events.ts'
import { loadVersions } from '../../packages/desktop/src/data/versions.ts'
import { gapFillAfter, gapFillSince, mergeEvents } from '../../packages/desktop/src/lib/timeline.ts'
import { closeChannels, listen, waitFor, warmUpRealtime } from '../helpers/realtime'
import { createAgentVersion, createPieceFixture, dbClient, serviceClient, type PieceFixture } from '../helpers/supabase'

async function post(client: SupabaseClient, pieceId: string, text: string): Promise<number> {
  const { data, error } = await client.rpc('post_message', { p_piece: pieceId, p_text: text })
  if (error) throw error
  return (data as { id: number }).id
}

/** Counts of each callback, plus the events received, for one subscribePiece call. */
function recorder() {
  const r = { events: [] as SessionEvent[], versions: 0, comments: 0, pieces: 0, subscribed: 0 }
  const handlers = {
    onEvent: (e: SessionEvent) => { r.events.push(e) },
    onVersion: () => { r.versions++ },
    onComment: () => { r.comments++ },
    onPiece: () => { r.pieces++ },
    onSubscribed: () => { r.subscribed++ },
  }
  return { r, handlers }
}

/** Subscribes as the designer and waits for the channel to be live. */
async function subscribed(f: PieceFixture, handlers: Parameters<typeof subscribePiece>[2]): Promise<() => void> {
  const client = f.t.members.designer.client
  // Realtime checks RLS with the user's JWT.
  await client.realtime.setAuth()
  let live = false
  const stop = subscribePiece(client, f.pieceId, { ...handlers, onSubscribed: () => { live = true; handlers.onSubscribed() } })
  const deadline = Date.now() + 10_000
  while (!live) {
    if (Date.now() > deadline) throw new Error('piece channel did not join')
    await new Promise((r) => setTimeout(r, 50))
  }
  return stop
}

it('loadEvents returns only events after the given id, in order', async () => {
  const f = await createPieceFixture()
  const gestor = f.t.members.gestor.client
  const ids = [await post(gestor, f.pieceId, 'um'), await post(gestor, f.pieceId, 'dois'), await post(gestor, f.pieceId, 'três')]
  // A row with a body the app cannot read is left out instead of breaking the chat.
  const { error } = await serviceClient().from('session_events')
    .insert({ piece_id: f.pieceId, team_id: f.t.teamId, kind: 'user_message', body: { nada: true }, to_agent: false, delivery: 'not_applicable' })
  expect(error).toBeNull()

  const viewer = f.t.members.espectador.client
  const all = await loadEvents(viewer, f.pieceId)
  expect(all.map((e) => e.id)).toEqual(ids)
  expect(all.map((e) => e.kind === 'user_message' && e.body.text)).toEqual(['um', 'dois', 'três'])
  expect((await loadEvents(viewer, f.pieceId, ids[0])).map((e) => e.id)).toEqual(ids.slice(1))
  expect(await loadEvents(viewer, f.pieceId, ids[2])).toEqual([])
  // Another piece's events never show up.
  const other = await createPieceFixture(f.t)
  expect(await loadEvents(viewer, other.pieceId)).toEqual([])
})

it('loadEvents reads past the 1000-row page limit', async () => {
  const f = await createPieceFixture()
  const rows = Array.from({ length: 1_005 }, (_, i) => ({
    piece_id: f.pieceId, team_id: f.t.teamId, kind: 'user_message',
    body: { text: `m${i}`, model: null, reference_asset_ids: [] }, to_agent: false, delivery: 'not_applicable',
  }))
  const { error } = await serviceClient().from('session_events').insert(rows)
  expect(error).toBeNull()

  const events = await loadEvents(f.t.members.espectador.client, f.pieceId)
  expect(events).toHaveLength(1_005)
  const last = events.at(-1)
  expect(last?.kind === 'user_message' && last.body.text).toBe('m1004')
  expect(new Set(events.map((e) => e.id)).size).toBe(1_005)
}, 60_000)

it('loadVersions lists the piece versions by number', async () => {
  const f = await createPieceFixture()
  const first = await createAgentVersion(f, { caption: 'Primeira' })
  const second = await createAgentVersion(f, { caption: 'Segunda' })
  const versions = await loadVersions(f.t.members.espectador.client, f.pieceId)
  expect(versions).toEqual([
    {
      id: first.id, piece_id: f.pieceId, number: 1, origin: 'agente', phase: 'base', image_path: first.image_path,
      caption: 'Primeira', author_id: null, created_at: expect.any(String),
    },
    expect.objectContaining({ id: second.id, number: 2, image_path: second.image_path, caption: 'Segunda' }),
  ])
})

describe('live piece', () => {
  beforeAll(warmUpRealtime, 40_000)
  afterEach(closeChannels)

  it('subscribePiece delivers new events and delivery updates', async () => {
    const f = await createPieceFixture()
    const { r, handlers } = recorder()
    const stop = await subscribed(f, handlers)
    expect(r.subscribed).toBe(1)
    // Realtime may still deliver the fixture's own rows, written just before the channel joined.
    await new Promise((res) => setTimeout(res, 1_500))
    r.events = []
    r.pieces = 0

    const id = await post(f.t.members.gestor.client, f.pieceId, 'Gerar versão')
    await waitFor(() => r.events.length >= 1)
    expect(r.events).toEqual([expect.objectContaining({ id, kind: 'user_message', to_agent: true, delivery: 'queued' })])

    const { error } = await serviceClient().from('session_events').update({ delivery: 'claimed' }).eq('id', id)
    expect(error).toBeNull()
    await waitFor(() => r.events.length >= 2)
    expect(r.events[1]).toMatchObject({ id, delivery: 'claimed' })
    // claimed_by is the executor's business: the parsed event drops it.
    expect(r.events[1]).not.toHaveProperty('claimed_by')

    // Versions (the agent's version also writes events), comments and the piece itself.
    const v = await createAgentVersion(f)
    await waitFor(() => r.versions >= 1 && r.pieces >= 1)
    expect(r.versions).toBe(1)
    // The first base version also moves the piece to "Base em revisão".
    expect(r.pieces).toBe(1)
    r.pieces = 0
    const admin = serviceClient()
    const { data: comment, error: commentError } = await admin.from('comments')
      .insert({ version_id: v.id, piece_id: f.pieceId, team_id: f.t.teamId, body: 'Mais claro' }).select('id').single()
    expect(commentError).toBeNull()
    await admin.from('comments').update({ resolved: true }).eq('id', comment!.id)
    await waitFor(() => r.comments >= 2)
    expect(r.comments).toBe(2)
    await renamePiece(f.t.members.gestor.client, f.pieceId, 'Renomeada')
    await waitFor(() => r.pieces >= 1)
    expect(r.pieces).toBe(1)

    // Another piece of the same team is not on this channel.
    const other = await createPieceFixture(f.t)
    const before = r.events.length
    await post(f.t.members.gestor.client, other.pieceId, 'outra peça')
    await waitFor(() => false)
    expect(r.events.length).toBe(before)

    stop()
    await waitFor(() => f.t.members.designer.client.getChannels().length === 0)
    expect(f.t.members.designer.client.getChannels()).toEqual([])
  }, 60_000)

  it('gap fill after resubscribe misses nothing', async () => {
    const f = await createPieceFixture()
    const designer = f.t.members.designer.client
    const gestor = f.t.members.gestor.client
    // What the Chat does: live events merge in, and every SUBSCRIBED loads what came after the last one seen.
    let state: SessionEvent[] = []
    let fills = 0
    const handlers = {
      onEvent: (e: SessionEvent) => { state = mergeEvents(state, [e]) },
      onVersion() {}, onComment() {}, onPiece() {},
      onSubscribed: () => {
        void loadEvents(designer, f.pieceId, gapFillAfter(state)).then((es) => {
          state = mergeEvents(state, es)
          fills++
        })
      },
    }

    // Another person stays online. Realtime hands a new channel the changes it has not processed yet,
    // so without this listener the "missed" rows could still reach the new channel live.
    const keeper = await listen(f.t.members.espectador.client, [{ table: 'session_events', filter: `piece_id=eq.${f.pieceId}` }])
    let stop = await subscribed(f, handlers)
    await waitFor(() => fills >= 1)
    const first = await post(gestor, f.pieceId, 'antes')
    await waitFor(() => state.length >= 1)
    expect(state[0]).toMatchObject({ id: first, delivery: 'queued' })
    stop()

    // Offline: the channel is gone while two messages are posted and the agent takes the first one.
    const missed = [await post(gestor, f.pieceId, 'perdida 1'), await post(gestor, f.pieceId, 'perdida 2')]
    const { error } = await serviceClient().from('session_events').update({ delivery: 'claimed' }).eq('id', first)
    expect(error).toBeNull()
    const seen = (id: number, delivery = 'queued') =>
      keeper.some((c) => (c.new as { id?: number; delivery?: string }).id === id && (c.new as { delivery?: string }).delivery === delivery)
    await waitFor(() => seen(missed[0]!) && seen(missed[1]!) && seen(first, 'claimed'))
    expect(state.map((e) => e.id)).toEqual([first])

    stop = await subscribed(f, handlers)
    await waitFor(() => fills >= 2)
    expect(state.map((e) => e.id)).toEqual([first, ...missed])
    // The missed delivery update is not lost either.
    expect(state[0]).toMatchObject({ id: first, delivery: 'claimed' })

    const after = await post(gestor, f.pieceId, 'depois')
    await waitFor(() => state.length >= 4)
    expect(state.map((e) => e.id)).toEqual([first, ...missed, after])
    stop()
  }, 60_000)

  it('a dropped socket rejoins, runs onSubscribed again and the gap fill catches up', async () => {
    const f = await createPieceFixture()
    const designer = f.t.members.designer.client
    const gestor = f.t.members.gestor.client
    let state: SessionEvent[] = []
    let fills = 0
    const stop = await subscribed(f, {
      onEvent: (e) => { state = mergeEvents(state, [e]) },
      onVersion() {}, onComment() {}, onPiece() {},
      onSubscribed: () => {
        void loadEvents(designer, f.pieceId, gapFillAfter(state)).then((es) => {
          state = mergeEvents(state, es)
          fills++
        })
      },
    })
    await waitFor(() => fills >= 1)

    // The Wi-Fi drops: the socket closes without a clean disconnect, so realtime-js reconnects by itself.
    const socket = (designer.realtime as unknown as { socketAdapter: { getSocket(): { conn: WebSocket } } })
      .socketAdapter.getSocket()
    socket.conn.close()
    const missed = [await post(gestor, f.pieceId, 'perdida 1'), await post(gestor, f.pieceId, 'perdida 2')]

    await waitFor(() => fills >= 2 && state.length >= 2)
    expect(fills).toBeGreaterThanOrEqual(2)
    expect(state.map((e) => e.id)).toEqual(missed)
    stop()
  }, 60_000)
})

it('gap fill finds an event that committed after a higher id', async () => {
  const f = await createPieceFixture()
  const designer = f.t.members.designer.client
  const db = await dbClient()
  try {
    // M takes its id first but commits last.
    await db.query('begin')
    const { rows } = await db.query<{ id: string }>(
      `insert into public.session_events (piece_id, team_id, author_id, kind, body, to_agent, delivery)
       values ($1, $2, $3, 'user_message', $4, false, 'not_applicable') returning id`,
      [f.pieceId, f.t.teamId, f.t.members.gestor.userId, { text: 'Atrasada', model: null, reference_asset_ids: [] }],
    )
    // pg returns bigint as text.
    const m = Number(rows[0]!.id)
    const h = await post(f.t.members.gestor.client, f.pieceId, 'Primeira a chegar')
    expect(h).toBeGreaterThan(m)
    const state = await loadEvents(designer, f.pieceId)
    expect(state.map((e) => e.id)).toEqual([h])
    await db.query('commit')

    // The id cursor alone skips M for good.
    expect((await loadEvents(designer, f.pieceId, gapFillAfter(state))).map((e) => e.id)).not.toContain(m)
    const filled = await loadEvents(designer, f.pieceId, gapFillAfter(state), gapFillSince(state))
    expect(filled.map((e) => e.id)).toContain(m)
  } finally {
    await db.query('rollback').catch(() => {})
    await db.end()
  }
})
