import { randomUUID } from 'node:crypto'
import { ClaimLostError, createExecutorDb } from '../../packages/executor/src/db.ts'
import {
  createAgentVersion, createClaimedMessage, createPieceFixture, loadEvent, serviceClient, TEST_EXECUTOR,
  uploadTeamFile, type PieceFixture,
} from '../helpers/supabase'

const KEY = 'sk-executor-db-1234567890abcd'
const db = () => createExecutorDb(serviceClient(), TEST_EXECUTOR)

async function insertReference(f: PieceFixture, campaignId: string): Promise<{ id: string; storage_path: string }> {
  const storage_path = await uploadTeamFile(`${f.t.teamId}/${campaignId}/${randomUUID()}.png`)
  const { data, error } = await serviceClient().from('reference_assets')
    .insert({ campaign_id: campaignId, team_id: f.t.teamId, original_name: 'produto.png', storage_path })
    .select('id, storage_path').single()
  if (error || !data) throw new Error(`insert reference failed: ${error?.message}`)
  return data
}

it('loadPieceContext returns history with author names, keyed providers and latest version', async () => {
  const f = await createPieceFixture()
  expect((await f.t.members.admin.client.rpc('set_provider_key', { p_team: f.t.teamId, p_provider: 'anthropic', p_key: KEY })).error).toBeNull()
  await createAgentVersion(f, { caption: 'Primeira' })
  const latest = await createAgentVersion(f, { caption: 'Segunda' })

  const first = await createClaimedMessage(f, TEST_EXECUTOR, { text: 'Banner azul', model: { text: { provider: 'anthropic', model: 'm' } } })
  await db().addAgentEvent(first, 'agent_result', { text: 'ok', image_prompt: 'prompt antigo' })
  await db().addAgentEvent(first, 'agent_result', { text: 'ok', image_prompt: 'prompt novo' })
  // A text-only round has no image prompt; the last image prompt stays.
  await db().addAgentEvent(first, 'agent_result', { text: 'ok', image_prompt: null })
  await db().complete(first, 'done')
  // Message whose author account is gone: author_id is null.
  const { error } = await serviceClient().from('session_events').insert({
    piece_id: f.pieceId, team_id: f.t.teamId, author_id: null, kind: 'user_message',
    body: { text: 'Sem autor', model: null, reference_asset_ids: [] }, to_agent: true, delivery: 'failed',
  })
  expect(error).toBeNull()

  const ctx = await db().loadPieceContext(f.pieceId)
  expect(ctx.piece).toEqual({
    id: f.pieceId, team_id: f.t.teamId, campaign_id: f.campaignId, title: 'Peça de teste', kind: 'imagem_texto', status: 'base_em_revisao',
  })
  expect(ctx.campaignName).toBe('Campanha de teste')
  expect(ctx.latestVersion).toEqual({ id: latest.id, number: 2, image_path: latest.image_path, caption: 'Segunda' })
  expect(ctx.lastImagePrompt).toBe('prompt novo')
  expect(ctx.keyedProviders).toEqual(['anthropic'])
  expect(ctx.memberNames[f.t.members.designer.userId]).toBe('designer')
  expect(Object.keys(ctx.memberNames)).toHaveLength(4)
  const tail = ctx.history.slice(-2)
  expect(tail).toEqual([
    { id: first, author: 'gestor', text: 'Banner azul', model: { text: { provider: 'anthropic', model: 'm' } }, reference_asset_ids: [] },
    expect.objectContaining({ author: 'Alguém', text: 'Sem autor' }),
  ])
  expect(ctx.history.map((h) => h.id)).toEqual([...ctx.history.map((h) => h.id)].sort((a, b) => a - b))
})

it('history keeps only the 30 most recent agent messages', async () => {
  const f = await createPieceFixture()
  const rows = Array.from({ length: 32 }, (_, i) => ({
    piece_id: f.pieceId, team_id: f.t.teamId, author_id: f.t.members.gestor.userId, kind: 'user_message',
    body: { text: `m${i}`, model: null, reference_asset_ids: [] }, to_agent: true, delivery: 'done',
  }))
  for (const row of rows) expect((await serviceClient().from('session_events').insert(row)).error).toBeNull()
  const { history } = await db().loadPieceContext(f.pieceId)
  expect(history.map((h) => h.text)).toEqual(rows.slice(2).map((r) => r.body.text))
})

it('history excludes queued and people-only messages', async () => {
  const f = await createPieceFixture()
  const claimed = await createClaimedMessage(f, TEST_EXECUTOR, { text: 'Pedido' })
  const gestor = f.t.members.gestor.client
  expect((await gestor.rpc('post_message', { p_piece: f.pieceId, p_text: 'Na fila' })).error).toBeNull()
  expect((await gestor.rpc('post_message', {
    p_piece: f.pieceId, p_text: '@designer olha isso', p_mention_user_ids: [f.t.members.designer.userId],
  })).error).toBeNull()
  const ctx = await db().loadPieceContext(f.pieceId)
  expect(ctx.history.map((h) => h.id)).toEqual([claimed])
  expect(ctx.latestVersion).toBeNull()
  expect(ctx.lastImagePrompt).toBeNull()
  expect(ctx.keyedProviders).toEqual([])
})

it('loadPieceContext fails with the operation name for an unknown piece', async () => {
  await expect(db().loadPieceContext(randomUUID())).rejects.toThrow(/loadPieceContext/)
})

it('addAgentVersion throws ClaimLostError when the claim is gone', async () => {
  const f = await createPieceFixture(undefined, 'texto')
  const source = await createClaimedMessage(f, 'outro-executor')
  await expect(db().addAgentVersion(f.pieceId, null, 'Legenda', source)).rejects.toBeInstanceOf(ClaimLostError)
  await expect(db().addAgentEvent(source, 'agent_started', {})).rejects.toBeInstanceOf(ClaimLostError)
  await expect(db().complete(source, 'done')).rejects.toBeInstanceOf(ClaimLostError)
})

it('addAgentVersion returns the new version id and number', async () => {
  const f = await createPieceFixture(undefined, 'texto')
  const source = await createClaimedMessage(f)
  const v = await db().addAgentVersion(f.pieceId, null, 'Legenda', source)
  expect(v).toEqual({ id: expect.any(String), number: 1 })
})

it('non-claim errors keep the Supabase message and the operation name', async () => {
  const f = await createPieceFixture(undefined, 'texto')
  const source = await createClaimedMessage(f)
  // A text piece rejects an image: 22023, not a lost claim.
  const err = await db().addAgentVersion(f.pieceId, `${f.t.teamId}/${f.pieceId}/x.png`, 'Legenda', source).catch((e) => e)
  expect(err).toBeInstanceOf(Error)
  expect(err).not.toBeInstanceOf(ClaimLostError)
  expect(err.message).toMatch(/addAgentVersion/)
})

it('absorbPending and touchClaim work on the executor claim', async () => {
  const f = await createPieceFixture()
  const first = await createClaimedMessage(f)
  const { data: next } = await f.t.members.designer.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: 'Fundo mais claro', p_model: { text: 'x' },
  })
  const absorbed = await db().absorbPending(f.pieceId)
  expect(absorbed).toEqual([await loadEvent(next.id)])
  expect(absorbed[0]).toEqual({
    id: next.id, piece_id: f.pieceId, team_id: f.t.teamId, author_id: f.t.members.designer.userId,
    body: { text: 'Fundo mais claro', model: { text: 'x' }, reference_asset_ids: [] },
  })
  expect(await db().absorbPending(f.pieceId)).toEqual([])
  await expect(db().touchClaim(f.pieceId)).resolves.toBeUndefined()

  await db().complete(first, 'done')
  await db().complete(next.id, 'failed')
  await expect(db().touchClaim(f.pieceId)).rejects.toBeInstanceOf(ClaimLostError)
  await expect(db().absorbPending(f.pieceId)).rejects.toBeInstanceOf(ClaimLostError)
})

it('getProviderKey returns the team key or null', async () => {
  const f = await createPieceFixture()
  expect((await f.t.members.admin.client.rpc('set_provider_key', { p_team: f.t.teamId, p_provider: 'openai', p_key: KEY })).error).toBeNull()
  expect(await db().getProviderKey(f.t.teamId, 'openai')).toBe(KEY)
  expect(await db().getProviderKey(f.t.teamId, 'gemini')).toBeNull()
})

it('loadReferencePaths ignores ids from another campaign', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const a = await insertReference(f, f.campaignId)
  const b = await insertReference(f, f.campaignId)
  const foreign = await insertReference(f, other.campaignId)
  const paths = await db().loadReferencePaths(f.t.teamId, f.campaignId, [b.id, foreign.id, a.id])
  expect(paths).toEqual([b, a])
  expect(await db().loadReferencePaths(f.t.teamId, f.campaignId, [])).toEqual([])
})

it('uploadFile then downloadFile round-trips bytes and mime type', async () => {
  const f = await createPieceFixture()
  const path = `${f.t.teamId}/${f.pieceId}/${randomUUID()}.webp`
  const bytes = new Uint8Array([1, 2, 3, 250])
  await db().uploadFile(path, bytes, 'image/webp')
  expect(await db().downloadFile(path)).toEqual({ bytes, mimeType: 'image/webp' })
  // upsert: false keeps the first file.
  await expect(db().uploadFile(path, new Uint8Array([9]), 'image/webp')).rejects.toThrow(/uploadFile/)
  await db().removeFile(path)
  await expect(db().downloadFile(path)).rejects.toThrow(/downloadFile/)
})
