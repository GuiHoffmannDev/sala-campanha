import { createAgentVersion, createPieceFixture, dbQuery, serviceClient, uploadTeamFile, type PieceFixture } from '../helpers/supabase'

const KEY = 'sk-cascade-1234567890abcd'

/** Piece with two versions, an approved base, a comment with a reply, conversation events and a reference. */
async function fullPiece(f: PieceFixture) {
  const ref = await serviceClient().from('reference_assets').insert({
    campaign_id: f.campaignId, team_id: f.t.teamId, original_name: 'produto.png',
    storage_path: await uploadTeamFile(`${f.t.teamId}/${f.campaignId}/produto.png`),
  })
  if (ref.error) throw new Error(`reference failed: ${ref.error.message}`)

  const base = await createAgentVersion(f)
  await createAgentVersion(f, { caption: 'Outra' })
  const { error: approveError } = await f.t.members.gestor.client.rpc('approve_version', { p_piece: f.pieceId, p_version: base.id })
  if (approveError) throw new Error(`approve failed: ${approveError.message}`)

  const d = f.t.members.designer
  const { data: root, error } = await d.client.from('comments')
    .insert({ version_id: base.id, piece_id: f.pieceId, team_id: f.t.teamId, author_id: d.userId, body: 'Logo menor', x: 0.5, y: 0.5 })
    .select('id').single()
  if (error || !root) throw new Error(`comment failed: ${error?.message}`)
  const reply = await d.client.from('comments')
    .insert({ version_id: base.id, piece_id: f.pieceId, team_id: f.t.teamId, author_id: d.userId, body: 'Feito', parent_id: root.id })
  if (reply.error) throw new Error(`reply failed: ${reply.error.message}`)
}

async function countByPiece(pieceId: string) {
  const counts: Record<string, number> = {}
  for (const table of ['piece_versions', 'comments', 'session_events']) {
    const { count, error } = await serviceClient().from(table).select('*', { count: 'exact', head: true }).eq('piece_id', pieceId)
    if (error) throw new Error(`count ${table} failed: ${error.message}`)
    counts[table] = count ?? -1
  }
  return counts
}

it('deleting a piece removes its versions, approval, comments and events', async () => {
  const f = await createPieceFixture()
  await fullPiece(f)
  expect(Object.values(await countByPiece(f.pieceId)).every((n) => n > 0)).toBe(true)

  const { error } = await serviceClient().from('pieces').delete().eq('id', f.pieceId)
  expect(error).toBeNull()
  expect(await countByPiece(f.pieceId)).toEqual({ piece_versions: 0, comments: 0, session_events: 0 })
})

it('deleting a team removes everything it owns, Vault secret included', async () => {
  const f = await createPieceFixture()
  await fullPiece(f)
  const { error: keyError } = await f.t.members.admin.client.rpc('set_provider_key', { p_team: f.t.teamId, p_provider: 'openai', p_key: KEY })
  expect(keyError).toBeNull()
  const [{ id: secretId } = { id: '' }] = await dbQuery<{ id: string }>(
    'select vault_secret_id as id from public.provider_keys where team_id = $1', [f.t.teamId],
  )

  const tables = ['team_members', 'campaigns', 'pieces', 'reference_assets', 'piece_versions', 'comments', 'session_events', 'provider_keys']
  const countOf = async (table: string) =>
    (await dbQuery(`select 1 from public.${table} where team_id = $1`, [f.t.teamId])).length
  // Positive control: every table has rows of the team before the delete.
  for (const table of tables) expect(await countOf(table), table).toBeGreaterThan(0)

  const { error } = await serviceClient().from('teams').delete().eq('id', f.t.teamId)
  expect(error).toBeNull()

  for (const table of tables) expect(await countOf(table), table).toBe(0)
  expect(await dbQuery('select 1 from vault.secrets where id = $1', [secretId])).toEqual([])
})
