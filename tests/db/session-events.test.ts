import { createPieceFixture, serviceClient, type PieceFixture } from '../helpers/supabase'

async function createReferenceAsset(f: PieceFixture, campaignId = f.campaignId): Promise<string> {
  const { data, error } = await serviceClient().from('reference_assets')
    .insert({ campaign_id: campaignId, team_id: f.t.teamId, storage_path: `${f.t.teamId}/ref.png`, original_name: 'ref.png', uploaded_by: f.t.members.admin.userId })
    .select('id').single()
  if (error || !data) throw new Error(`insert reference_asset failed: ${error?.message}`)
  return data.id
}

it('plain message goes to agent queue', async () => {
  const f = await createPieceFixture()
  const ref = await createReferenceAsset(f)
  const model = { provider: 'gemini', model: 'imagen' }
  const { data, error } = await f.t.members.gestor.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: 'Fundo escuro, clima premium', p_model: model, p_reference_asset_ids: [ref],
  })
  expect(error).toBeNull()
  expect(data).toMatchObject({
    piece_id: f.pieceId, team_id: f.t.teamId, to_agent: true, delivery: 'queued', kind: 'user_message',
    author_id: f.t.members.gestor.userId, mention_user_ids: [],
    body: { text: 'Fundo escuro, clima premium', model, reference_asset_ids: [ref] },
  })
})

it('message starting with @mention goes to people only', async () => {
  const f = await createPieceFixture()
  const { data, error } = await f.t.members.designer.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: '  @Gestor o que acha?', p_mention_user_ids: [f.t.members.gestor.userId],
  })
  expect(error).toBeNull()
  expect(data).toMatchObject({ to_agent: false, delivery: 'not_applicable', mention_user_ids: [f.t.members.gestor.userId] })
})

it('Unicode spaces before @mention still mean people only', async () => {
  const f = await createPieceFixture()
  const { data, error } = await f.t.members.designer.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: ' ​@Gestor oi', p_mention_user_ids: [f.t.members.gestor.userId],
  })
  expect(error).toBeNull()
  expect(data).toMatchObject({ to_agent: false, delivery: 'not_applicable' })
})

it('repeated mentions are stored once, in order', async () => {
  const f = await createPieceFixture()
  const { gestor, admin } = f.t.members
  const { data, error } = await f.t.members.designer.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: '@Gestor @Admin oi', p_mention_user_ids: [gestor.userId, admin.userId, gestor.userId],
  })
  expect(error).toBeNull()
  expect(data.mention_user_ids).toEqual([gestor.userId, admin.userId])
})

it('@ without mention ids still goes to agent', async () => {
  const f = await createPieceFixture()
  const { data } = await f.t.members.designer.client.rpc('post_message', { p_piece: f.pieceId, p_text: '@algo' })
  expect(data).toMatchObject({ to_agent: true, delivery: 'queued' })
})

it('mention not at the start still goes to agent', async () => {
  const f = await createPieceFixture()
  const { data } = await f.t.members.designer.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: 'Ajuste o fundo, @Gestor', p_mention_user_ids: [f.t.members.gestor.userId],
  })
  expect(data).toMatchObject({ to_agent: true, delivery: 'queued' })
})

it('rejects empty text', async () => {
  const f = await createPieceFixture()
  for (const p_text of ['   ', ' ​　']) {
    const { error } = await f.t.members.designer.client.rpc('post_message', { p_piece: f.pieceId, p_text })
    expect(error?.code).toBe('22023')
  }
})

it('espectador cannot post', async () => {
  const f = await createPieceFixture()
  const { error } = await f.t.members.espectador.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'oi' })
  expect(error?.code).toBe('42501')
})

it('rejects piece from another team', async () => {
  const a = await createPieceFixture(); const b = await createPieceFixture()
  const { error } = await a.t.members.admin.client.rpc('post_message', { p_piece: b.pieceId, p_text: 'oi' })
  expect(error?.code).toBe('42501')
  const { data } = await serviceClient().from('session_events').select('id').eq('piece_id', b.pieceId)
  expect(data).toEqual([])
})

it('rejects mention of user from another team', async () => {
  const a = await createPieceFixture(); const b = await createPieceFixture()
  const { error } = await a.t.members.gestor.client.rpc('post_message', {
    p_piece: a.pieceId, p_text: '@Fulano oi', p_mention_user_ids: [b.t.members.gestor.userId],
  })
  expect(error?.code).toBe('22023')
})

it('rejects reference asset from another campaign', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const ref = await createReferenceAsset(other)
  const { error } = await f.t.members.gestor.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: 'Use a foto', p_reference_asset_ids: [ref],
  })
  expect(error?.code).toBe('22023')
})

it('rejects reference asset from another team', async () => {
  const a = await createPieceFixture(); const b = await createPieceFixture()
  const ref = await createReferenceAsset(b)
  const { error } = await a.t.members.gestor.client.rpc('post_message', {
    p_piece: a.pieceId, p_text: 'Use a foto', p_reference_asset_ids: [ref],
  })
  expect(error?.code).toBe('22023')
})

it('members read events; other teams and direct writes do not', async () => {
  const a = await createPieceFixture(); const b = await createPieceFixture()
  const { data: event, error: postError } = await a.t.members.gestor.client.rpc('post_message', { p_piece: a.pieceId, p_text: 'oi' })
  expect(postError).toBeNull()

  const { data: seen } = await a.t.members.espectador.client.from('session_events').select('id').gt('id', 0)
  expect(seen).toEqual([{ id: event.id }])
  const { data: foreign } = await b.t.members.admin.client.from('session_events').select('id').eq('piece_id', a.pieceId)
  expect(foreign).toEqual([])

  const designer = a.t.members.designer.client
  const { error: insertError } = await designer.from('session_events').insert({
    piece_id: a.pieceId, team_id: a.t.teamId, kind: 'agent_result', body: {}, to_agent: false, delivery: 'not_applicable',
  })
  expect(insertError?.code).toBe('42501')
  await designer.from('session_events').update({ delivery: 'done' }).eq('id', event.id)
  const { data: after } = await serviceClient().from('session_events').select('delivery').eq('id', event.id).single()
  expect(after!.delivery).toBe('queued')
})
