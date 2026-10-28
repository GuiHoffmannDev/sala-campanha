import { createAgentVersion, createPieceFixture } from '../helpers/supabase'
import { closeChannels, foreign, listen, waitFor, warmUpRealtime } from '../helpers/realtime'

const TABLES = ['session_events', 'pieces', 'piece_versions', 'comments'] as const

afterEach(closeChannels)
beforeAll(warmUpRealtime, 40_000)

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
  const version = await createAgentVersion(a)
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
