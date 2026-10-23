import type { SupabaseClient } from '@supabase/supabase-js'
import { createPieceFixture, createTestTeam, serviceClient, type PieceFixture } from '../helpers/supabase'

type Version = { id: string; piece_id: string; number: number; origin: string; phase: string; image_path: string | null; caption: string | null; author_id: string | null }

const img = (f: PieceFixture, name = 'base.png') => `${f.t.teamId}/${f.pieceId}/${name}`

async function agentVersion(f: PieceFixture, caption: string | null = 'Legenda base', image: string | null = img(f)): Promise<Version> {
  const { data, error } = await serviceClient().rpc('add_agent_version', {
    p_piece: f.pieceId, p_image_path: image, p_caption: caption, p_source_event: null,
  })
  if (error || !data) throw new Error(`add_agent_version failed: ${error?.message}`)
  return data
}

async function pieceOf(pieceId: string) {
  const { data, error } = await serviceClient().from('pieces').select('status, approved_version_id').eq('id', pieceId).single()
  if (error || !data) throw new Error(`select piece failed: ${error?.message}`)
  return data as { status: string; approved_version_id: string | null }
}

async function eventsOf(pieceId: string) {
  const { data, error } = await serviceClient().from('session_events')
    .select('kind, body, author_id, to_agent, delivery').eq('piece_id', pieceId).order('id')
  if (error || !data) throw new Error(`select events failed: ${error?.message}`)
  return data
}

const approve = (c: SupabaseClient, pieceId: string, versionId: string) =>
  c.rpc('approve_version', { p_piece: pieceId, p_version: versionId })

/** Piece in `acabamento` with an approved base version. */
async function inAcabamento(f: PieceFixture): Promise<Version> {
  const base = await agentVersion(f)
  const { error } = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  if (error) throw new Error(`approve base failed: ${error.message}`)
  return base
}

it('agent version moves gerando to base_em_revisao', async () => {
  const f = await createPieceFixture()
  const v1 = await agentVersion(f)
  expect(v1).toMatchObject({ piece_id: f.pieceId, number: 1, origin: 'agente', phase: 'base', image_path: img(f), caption: 'Legenda base', author_id: null })
  expect((await pieceOf(f.pieceId)).status).toBe('base_em_revisao')

  const v2 = await agentVersion(f, 'Outra legenda')
  expect(v2.number).toBe(2)
  expect((await pieceOf(f.pieceId)).status).toBe('base_em_revisao')

  const events = await eventsOf(f.pieceId)
  expect(events.map((e) => e.kind)).toEqual(['version_added', 'status_changed', 'version_added'])
  expect(events[0]).toMatchObject({ body: { version_id: v1.id, number: 1, phase: 'base' }, to_agent: false, delivery: 'not_applicable' })
  expect(events[1]?.body).toEqual({ from: 'gerando', to: 'base_em_revisao' })
})

it('add_agent_version is denied to members', async () => {
  const f = await createPieceFixture()
  const { error } = await f.t.members.admin.client.rpc('add_agent_version', {
    p_piece: f.pieceId, p_image_path: img(f), p_caption: 'x', p_source_event: null,
  })
  expect(error?.code).toBe('42501')
  expect((await pieceOf(f.pieceId)).status).toBe('gerando')
})

it('add_agent_version rejects a source event from another piece', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const { data: msg } = await f.t.members.gestor.client.rpc('post_message', { p_piece: other.pieceId, p_text: 'Gerar' })
  const { error } = await serviceClient().rpc('add_agent_version', {
    p_piece: f.pieceId, p_image_path: img(f), p_caption: 'x', p_source_event: msg.id,
  })
  expect(error?.code).toBe('22023')
})

it('version must keep its image inside the team folder', async () => {
  const f = await createPieceFixture()
  const { error } = await serviceClient().rpc('add_agent_version', {
    p_piece: f.pieceId, p_image_path: 'outro-time/base.png', p_caption: null, p_source_event: null,
  })
  expect(error?.code).toBe('23514')
})

it('gestor approves base: acabamento; designer approval fails', async () => {
  const f = await createPieceFixture()
  const base = await agentVersion(f)

  for (const role of ['designer', 'espectador'] as const) {
    const { error } = await approve(f.t.members[role].client, f.pieceId, base.id)
    expect(error?.code).toBe('42501')
  }
  expect(await pieceOf(f.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })

  const { data, error } = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  expect(error).toBeNull()
  expect(data).toMatchObject({ status: 'acabamento', approved_version_id: base.id })

  const approval = (await eventsOf(f.pieceId)).at(-1)
  expect(approval).toMatchObject({
    kind: 'approval', author_id: f.t.members.gestor.userId,
    body: { version_id: base.id, from: 'base_em_revisao', to: 'acabamento' },
  })
})

it('upload final then approve: aprovada', async () => {
  const f = await createPieceFixture()
  await inAcabamento(f)

  const { data: final, error } = await f.t.members.designer.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: img(f, 'final.png'), p_caption: 'Legenda final',
  })
  expect(error).toBeNull()
  expect(final).toMatchObject({ number: 2, origin: 'upload', phase: 'final', author_id: f.t.members.designer.userId })
  expect((await pieceOf(f.pieceId)).status).toBe('final_em_revisao')

  // A second final while in review stays in final_em_revisao.
  const { data: final2 } = await f.t.members.designer.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: img(f, 'final2.png'), p_caption: 'Legenda final 2',
  })
  expect(final2.number).toBe(3)
  expect((await pieceOf(f.pieceId)).status).toBe('final_em_revisao')

  const approved = await approve(f.t.members.admin.client, f.pieceId, final2.id)
  expect(approved.error).toBeNull()
  expect(approved.data).toMatchObject({ status: 'aprovada', approved_version_id: final2.id })
})

it('upload_final_version requires acabamento or final_em_revisao and a writer', async () => {
  const f = await createPieceFixture()
  await agentVersion(f)
  const early = await f.t.members.designer.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: img(f, 'final.png'), p_caption: null,
  })
  expect(early.error?.code).toBe('22023')

  await approve(f.t.members.gestor.client, f.pieceId, (await agentVersion(f)).id)
  const viewer = await f.t.members.espectador.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: img(f, 'final.png'), p_caption: null,
  })
  expect(viewer.error?.code).toBe('42501')
  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')
})

it('texto piece approved directly from base_em_revisao', async () => {
  const t = await createTestTeam()
  const f = await createPieceFixture(t)
  const { data: piece, error: pieceError } = await serviceClient().from('pieces')
    .insert({ campaign_id: f.campaignId, team_id: t.teamId, title: 'Legenda', kind: 'texto', created_by: t.members.admin.userId })
    .select('id').single()
  if (pieceError || !piece) throw new Error(`insert texto piece failed: ${pieceError?.message}`)
  const texto = { ...f, pieceId: piece.id }

  const v = await agentVersion(texto, 'Só texto', null)
  const { data, error } = await approve(t.members.gestor.client, texto.pieceId, v.id)
  expect(error).toBeNull()
  expect(data).toMatchObject({ status: 'aprovada', approved_version_id: v.id })
})

it('rejects approval outside review status', async () => {
  const f = await createPieceFixture()
  const base = await inAcabamento(f)

  // acabamento is not a review status.
  const { error } = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  expect(error?.code).toBe('22023')
  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')

  // final_em_revisao only approves a final version.
  await f.t.members.designer.client.rpc('upload_final_version', { p_piece: f.pieceId, p_image_path: img(f, 'final.png'), p_caption: null })
  const wrongPhase = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  expect(wrongPhase.error?.code).toBe('22023')
  expect((await pieceOf(f.pieceId)).status).toBe('final_em_revisao')
})

it('rejects approving version of another piece', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  await agentVersion(f)
  const foreign = await agentVersion(other)

  const { error } = await approve(f.t.members.gestor.client, f.pieceId, foreign.id)
  expect(error?.code).toBe('22023')
  expect(await pieceOf(f.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })
  expect(await pieceOf(other.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })
})

it('step_back from gerando fails', async () => {
  const f = await createPieceFixture()
  const { error } = await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect(error?.message).toContain('no previous status')
  expect((await pieceOf(f.pieceId)).status).toBe('gerando')
  expect(await eventsOf(f.pieceId)).toEqual([])
})

it('step_back records status_changed event with author', async () => {
  const f = await createPieceFixture()
  await inAcabamento(f)

  const viewer = await f.t.members.espectador.client.rpc('step_back', { p_piece: f.pieceId })
  expect(viewer.error?.code).toBe('42501')

  const { data, error } = await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect(error).toBeNull()
  expect(data.status).toBe('base_em_revisao')

  expect((await eventsOf(f.pieceId)).at(-1)).toMatchObject({
    kind: 'status_changed', author_id: f.t.members.designer.userId,
    body: { from: 'acabamento', to: 'base_em_revisao' },
  })
})

it('update_caption creates a new version with the same image', async () => {
  const f = await createPieceFixture()
  const v1 = await agentVersion(f)

  const { data: v2, error } = await f.t.members.designer.client.rpc('update_caption', { p_version: v1.id, p_caption: 'Legenda editada' })
  expect(error).toBeNull()
  expect(v2).toMatchObject({ number: 2, phase: 'base', image_path: v1.image_path, caption: 'Legenda editada', author_id: f.t.members.designer.userId })
  expect((await eventsOf(f.pieceId)).at(-1)).toMatchObject({ kind: 'version_added', body: { version_id: v2.id, number: 2 } })

  const viewer = await f.t.members.espectador.client.rpc('update_caption', { p_version: v1.id, p_caption: 'x' })
  expect(viewer.error?.code).toBe('42501')
  const blank = await f.t.members.designer.client.rpc('update_caption', { p_version: v1.id, p_caption: '  ' })
  expect(blank.error?.code).toBe('22023')
})

it('update_caption rejects an approved version', async () => {
  const f = await createPieceFixture()
  const base = await inAcabamento(f)
  const { error } = await f.t.members.designer.client.rpc('update_caption', { p_version: base.id, p_caption: 'tarde demais' })
  expect(error?.code).toBe('22023')
})

it('members read versions of their team only', async () => {
  const f = await createPieceFixture()
  const b = await createTestTeam()
  const v = await agentVersion(f)

  const own = await f.t.members.espectador.client.from('piece_versions').select('id').eq('piece_id', f.pieceId)
  expect(own.data?.map((r) => r.id)).toEqual([v.id])
  const foreign = await b.members.admin.client.from('piece_versions').select('id').eq('piece_id', f.pieceId)
  expect(foreign.data).toEqual([])

  const write = await f.t.members.admin.client.from('piece_versions')
    .insert({ piece_id: f.pieceId, team_id: f.t.teamId, number: 9, origin: 'upload', phase: 'final', caption: 'x' })
  expect(write.error?.code).toBe('42501')
})

it('rejects piece from another team', async () => {
  const f = await createPieceFixture()
  const base = await inAcabamento(f)
  const b = await createTestTeam()

  const upload = await b.members.designer.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: `${b.teamId}/x.png`, p_caption: null,
  })
  expect(upload.error?.code).toBe('42501')
  expect((await b.members.admin.client.rpc('step_back', { p_piece: f.pieceId })).error?.code).toBe('42501')
  expect((await b.members.admin.client.rpc('update_caption', { p_version: base.id, p_caption: 'x' })).error?.code).toBe('42501')
  expect((await approve(b.members.gestor.client, f.pieceId, base.id)).error?.code).toBe('42501')

  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')
})
