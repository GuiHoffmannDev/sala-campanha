import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'
import { createPieceFixture, serviceClient } from '../helpers/supabase'

type Change = RealtimePostgresChangesPayload<Record<string, unknown>>
type Subscription = { table: string; filter?: string }

const TABLES = ['session_events', 'pieces', 'piece_versions', 'comments'] as const
const WAIT_MS = 5_000
// Extra time after the expected changes arrive, so a leak to another team has a chance to show up.
const GRACE_MS = 1_000

const clients: SupabaseClient[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.removeAllChannels()))
})

/** Subscribes `client` to postgres_changes and resolves once the channel is live. */
async function listen(client: SupabaseClient, subs: Subscription[]): Promise<Change[]> {
  clients.push(client)
  // Realtime checks RLS with the user's JWT, so the channel must carry it.
  await client.realtime.setAuth()
  const received: Change[] = []
  const channel = client.channel(`test-${crypto.randomUUID()}`)
  for (const s of subs) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: s.table, filter: s.filter }, (p) => received.push(p))
  }
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve()
      else if (status !== 'CLOSED') reject(new Error(`subscribe failed: ${status} ${err?.message ?? ''}`))
    })
  })
  return received
}

/** Changes about rows that do not belong to `teamId`. */
function foreign(changes: Change[], teamId: string): Change[] {
  return changes.filter((c) => (c.new as { team_id?: string }).team_id !== teamId)
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, GRACE_MS))
}

// Right after `db reset`, Realtime starts replication on the first
// subscription and drops changes made before it is up. Post probes until
// one arrives, so the tests below measure RLS filtering, not cold start.
beforeAll(async () => {
  const f = await createPieceFixture()
  const received = await listen(f.t.members.designer.client, [{ table: 'session_events', filter: `piece_id=eq.${f.pieceId}` }])
  const deadline = Date.now() + 25_000
  while (received.length === 0) {
    if (Date.now() > deadline) throw new Error('Realtime delivered no change within 25s')
    await f.t.members.designer.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'aquecimento' })
    await new Promise((r) => setTimeout(r, 1_000))
  }
  await f.t.members.designer.client.removeAllChannels()
  clients.length = 0
}, 40_000)

it('member receives new event; other team does not', async () => {
  const a = await createPieceFixture()
  const b = await createPieceFixture()
  const byPiece = { table: 'session_events', filter: `piece_id=eq.${a.pieceId}` }
  const aReceived = await listen(a.t.members.designer.client, [byPiece])
  // B knows A's piece id and also listens to everything: neither may leak.
  const bFiltered = await listen(b.t.members.designer.client, [byPiece])
  const bAll = await listen(b.t.members.gestor.client, [{ table: 'session_events' }])

  const { data, error } = await a.t.members.gestor.client.rpc('post_message', { p_piece: a.pieceId, p_text: 'Fundo escuro' })
  expect(error).toBeNull()

  await waitFor(() => aReceived.length > 0)
  expect(aReceived).toHaveLength(1)
  expect(aReceived[0]).toMatchObject({ eventType: 'INSERT', table: 'session_events', new: { id: data.id, piece_id: a.pieceId } })
  expect(bFiltered).toHaveLength(0)
  expect(foreign(bAll, b.t.teamId)).toEqual([])
})

it('pieces, versions and comments reach members of the team only', async () => {
  const a = await createPieceFixture()
  const b = await createPieceFixture()
  const espectador = await listen(a.t.members.espectador.client, [
    { table: 'pieces', filter: `id=eq.${a.pieceId}` },
    ...TABLES.filter((t) => t !== 'pieces').map((table) => ({ table, filter: `piece_id=eq.${a.pieceId}` })),
  ])
  const other = await listen(b.t.members.admin.client, TABLES.map((table) => ({ table })))

  // Agent result: new version, status gerando → base_em_revisao, status_changed event.
  const { data: version, error } = await serviceClient().rpc('add_agent_version', {
    p_piece: a.pieceId, p_image_path: `${a.t.teamId}/${a.pieceId}/base.png`, p_caption: 'Legenda', p_source_event: null,
  })
  expect(error).toBeNull()
  const designer = a.t.members.designer
  const comment = await designer.client.from('comments')
    .insert({ version_id: version.id, piece_id: a.pieceId, team_id: a.t.teamId, author_id: designer.userId, body: 'Logo menor' })
  expect(comment.error).toBeNull()

  const seen = () => new Set(espectador.map((c) => `${c.table}:${c.eventType}`))
  const expected = ['pieces:UPDATE', 'piece_versions:INSERT', 'session_events:INSERT', 'comments:INSERT']
  await waitFor(() => expected.every((e) => seen().has(e)))
  // The fixture's own pieces INSERT may also arrive late; only A's rows may show up.
  expect([...seen()]).toEqual(expect.arrayContaining(expected))
  expect(foreign(espectador, a.t.teamId)).toEqual([])
  expect(espectador.find((c) => c.table === 'pieces' && c.eventType === 'UPDATE')).toMatchObject({ new: { id: a.pieceId, status: 'base_em_revisao' } })
  // B may still get its own fixture inserts (WAL lag past SUBSCRIBED); nothing of another team.
  expect(foreign(other, b.t.teamId)).toEqual([])
})
