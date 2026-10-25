import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createAgentVersion, createClaimedMessage, createPieceFixture, createTestTeam, serviceClient,
  TEST_EXECUTOR, uploadPieceImage, uploadTeamFile, type PieceFixture, type Version,
} from '../helpers/supabase'

async function pieceOf(pieceId: string) {
  const { data, error } = await serviceClient().from('pieces').select('status, approved_version_id').eq('id', pieceId).single()
  if (error || !data) throw new Error(`select piece failed: ${error?.message}`)
  return data as { status: string; approved_version_id: string | null }
}

/** Events written by the version/status RPCs (user messages from the fixtures left out). */
async function eventsOf(pieceId: string) {
  const { data, error } = await serviceClient().from('session_events')
    .select('kind, body, author_id, to_agent, delivery').eq('piece_id', pieceId).neq('kind', 'user_message').order('id')
  if (error || !data) throw new Error(`select events failed: ${error?.message}`)
  return data
}

const approve = (c: SupabaseClient, pieceId: string, versionId: string) =>
  c.rpc('approve_version', { p_piece: pieceId, p_version: versionId })

const addAgentVersion = (f: PieceFixture, args: Record<string, unknown>) =>
  serviceClient().rpc('add_agent_version', { p_piece: f.pieceId, p_caption: 'x', p_executor: TEST_EXECUTOR, ...args })

async function uploadFinal(f: PieceFixture, caption: string | null = 'Legenda final') {
  return f.t.members.designer.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: await uploadPieceImage(f), p_caption: caption,
  })
}

/** Piece in `acabamento` with an approved base version. */
async function inAcabamento(f: PieceFixture): Promise<Version> {
  const base = await createAgentVersion(f)
  const { error } = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  if (error) throw new Error(`approve base failed: ${error.message}`)
  return base
}

/** Piece in `aprovada` with an approved base and an approved final. */
async function inAprovada(f: PieceFixture): Promise<{ base: Version; final: Version }> {
  const base = await inAcabamento(f)
  const { data: final, error } = await uploadFinal(f)
  if (error || !final) throw new Error(`upload final failed: ${error?.message}`)
  const approved = await approve(f.t.members.gestor.client, f.pieceId, final.id)
  if (approved.error) throw new Error(`approve final failed: ${approved.error.message}`)
  return { base, final }
}

/** texto piece with an approved agent version (status aprovada). */
async function approvedTexto(): Promise<{ f: PieceFixture; v: Version }> {
  const f = await createPieceFixture(undefined, 'texto')
  const v = await createAgentVersion(f, { caption: 'Só texto', image: false })
  const { error } = await approve(f.t.members.gestor.client, f.pieceId, v.id)
  if (error) throw new Error(`approve texto failed: ${error.message}`)
  return { f, v }
}

it('agent version moves gerando to base_em_revisao', async () => {
  const f = await createPieceFixture()
  const v1 = await createAgentVersion(f)
  expect(v1).toMatchObject({ piece_id: f.pieceId, number: 1, origin: 'agente', phase: 'base', caption: 'Legenda base', author_id: null })
  expect(v1.image_path).toMatch(new RegExp(`^${f.t.teamId}/${f.pieceId}/`))
  expect(v1.source_event_id).not.toBeNull()
  expect((await pieceOf(f.pieceId)).status).toBe('base_em_revisao')

  const v2 = await createAgentVersion(f, { caption: 'Outra legenda' })
  expect(v2.number).toBe(2)
  expect((await pieceOf(f.pieceId)).status).toBe('base_em_revisao')

  const events = await eventsOf(f.pieceId)
  expect(events.map((e) => e.kind)).toEqual(['version_added', 'status_changed', 'version_added'])
  expect(events[0]).toMatchObject({ body: { version_id: v1.id, number: 1, phase: 'base' }, to_agent: false, delivery: 'not_applicable' })
  expect(events[1]?.body).toEqual({ from: 'gerando', to: 'base_em_revisao' })
})

it('add_agent_version is denied to members', async () => {
  const f = await createPieceFixture()
  const source = await createClaimedMessage(f)
  const { error } = await f.t.members.admin.client.rpc('add_agent_version', {
    p_piece: f.pieceId, p_image_path: await uploadPieceImage(f), p_caption: 'x', p_source_event: source, p_executor: TEST_EXECUTOR,
  })
  expect(error?.code).toBe('42501')
  expect((await pieceOf(f.pieceId)).status).toBe('gerando')
})

it('add_agent_version needs a message of the piece claimed by the same executor', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const image = await uploadPieceImage(f)

  // No source message.
  expect((await addAgentVersion(f, { p_image_path: image, p_source_event: null })).error?.code).toBe('42501')

  // Message of another piece.
  const foreign = await createClaimedMessage(other)
  expect((await addAgentVersion(f, { p_image_path: image, p_source_event: foreign })).error?.code).toBe('42501')

  // Message still queued (never claimed).
  const { data: queued } = await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Gerar' })
  expect((await addAgentVersion(f, { p_image_path: image, p_source_event: queued.id })).error?.code).toBe('42501')

  // Claimed by another executor.
  const source = await createClaimedMessage(f, 'outro-executor')
  expect((await addAgentVersion(f, { p_image_path: image, p_source_event: source })).error?.code).toBe('42501')

  expect((await pieceOf(f.pieceId)).status).toBe('gerando')
  expect(await eventsOf(f.pieceId)).toEqual([])
})

it('a released claim taken by another executor rejects the first executor', async () => {
  const f = await createPieceFixture()
  const source = await createClaimedMessage(f, 'lento')
  // release_stale_claims('0 seconds') requeues every claim, so put the row
  // back to queued directly instead: other test files' claims stay untouched.
  await serviceClient().from('session_events').update({ delivery: 'queued', claimed_by: null, claimed_at: null }).eq('id', source)
  await serviceClient().from('session_events')
    .update({ delivery: 'claimed', claimed_by: 'rapido', claimed_at: new Date().toISOString() }).eq('id', source)

  const late = await addAgentVersion(f, { p_image_path: await uploadPieceImage(f), p_source_event: source, p_executor: 'lento' })
  expect(late.error?.code).toBe('42501')
  const winner = await addAgentVersion(f, { p_image_path: await uploadPieceImage(f), p_source_event: source, p_executor: 'rapido' })
  expect(winner.error).toBeNull()
})

it('add_agent_version is rejected outside gerando and base_em_revisao', async () => {
  const f = await createPieceFixture()
  await inAcabamento(f)
  const inFinishing = await addAgentVersion(f, { p_image_path: await uploadPieceImage(f), p_source_event: await createClaimedMessage(f) })
  expect(inFinishing.error?.code).toBe('22023')

  const { f: texto } = await approvedTexto()
  const inApproved = await addAgentVersion(texto, { p_image_path: null, p_caption: 'Nova', p_source_event: await createClaimedMessage(texto) })
  expect(inApproved.error?.code).toBe('22023')
  expect((await pieceOf(texto.pieceId)).status).toBe('aprovada')
})

it('version image must exist in the team folder', async () => {
  const f = await createPieceFixture()
  const b = await createTestTeam()
  const missing = await addAgentVersion(f, {
    p_image_path: `${f.t.teamId}/${f.pieceId}/nao-existe.png`, p_source_event: await createClaimedMessage(f),
  })
  expect(missing.error?.code).toBe('22023')
  expect(missing.error?.message).toContain('image file not found in the team folder')

  // The file exists, but in another team's folder: same error, so nothing is learned about it.
  const foreignPath = await uploadTeamFile(`${b.teamId}/base.png`)
  const foreign = await addAgentVersion(f, { p_image_path: foreignPath, p_source_event: await createClaimedMessage(f) })
  expect(foreign.error).toMatchObject({ code: missing.error?.code, message: missing.error?.message })
})

it('members cannot learn whether another team has a file', async () => {
  const f = await createPieceFixture()
  await inAcabamento(f)
  const b = await createTestTeam()
  const existing = await uploadTeamFile(`${b.teamId}/segredo.png`)
  const upload = (path: string) => f.t.members.designer.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: path, p_caption: 'x',
  })

  const a = await upload(existing)
  const c = await upload(`${b.teamId}/nao-existe.png`)
  expect(a.error?.code).toBe('22023')
  expect(a.error).toMatchObject({ code: c.error?.code, message: c.error?.message })
  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')
})

it('version content must match the piece kind', async () => {
  const cases = [
    { kind: 'imagem', ok: { image: true, caption: null }, bad: [{ image: false, caption: 'x' }, { image: true, caption: 'x' }] },
    { kind: 'texto', ok: { image: false, caption: 'x' }, bad: [{ image: true, caption: 'x' }, { image: true, caption: null }] },
    { kind: 'imagem_texto', ok: { image: true, caption: 'x' }, bad: [{ image: true, caption: null }, { image: false, caption: 'x' }] },
  ] as const
  for (const c of cases) {
    const f = await createPieceFixture(undefined, c.kind)
    for (const bad of c.bad) {
      const { error } = await addAgentVersion(f, {
        p_image_path: bad.image ? await uploadPieceImage(f) : null, p_caption: bad.caption, p_source_event: await createClaimedMessage(f),
      })
      expect(error?.code, `${c.kind} ${JSON.stringify(bad)}`).toBe('22023')
    }
    // Positive control: the matching package is accepted.
    await expect(createAgentVersion(f, c.ok)).resolves.toMatchObject({ number: 1 })
  }
})

it('gestor approves base: acabamento; designer approval fails', async () => {
  const f = await createPieceFixture()
  const base = await createAgentVersion(f)

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

it('an earlier version of the phase can be approved', async () => {
  const f = await createPieceFixture()
  const v1 = await createAgentVersion(f)
  await createAgentVersion(f, { caption: 'Mais nova' })

  const { data, error } = await approve(f.t.members.gestor.client, f.pieceId, v1.id)
  expect(error).toBeNull()
  expect(data).toMatchObject({ status: 'acabamento', approved_version_id: v1.id })
})

it('upload final then approve: aprovada', async () => {
  const f = await createPieceFixture()
  await inAcabamento(f)

  const { data: final, error } = await uploadFinal(f)
  expect(error).toBeNull()
  expect(final).toMatchObject({ number: 2, origin: 'upload', phase: 'final', author_id: f.t.members.designer.userId })
  expect((await pieceOf(f.pieceId)).status).toBe('final_em_revisao')

  // A second final while in review stays in final_em_revisao.
  const { data: final2 } = await uploadFinal(f, 'Legenda final 2')
  expect(final2.number).toBe(3)
  expect((await pieceOf(f.pieceId)).status).toBe('final_em_revisao')

  const approved = await approve(f.t.members.admin.client, f.pieceId, final2.id)
  expect(approved.error).toBeNull()
  expect(approved.data).toMatchObject({ status: 'aprovada', approved_version_id: final2.id })
})

it('upload_final_version requires acabamento or final_em_revisao, a writer and a full package', async () => {
  const f = await createPieceFixture()
  await createAgentVersion(f)
  expect((await uploadFinal(f)).error?.code).toBe('22023')

  await approve(f.t.members.gestor.client, f.pieceId, (await createAgentVersion(f)).id)
  const viewer = await f.t.members.espectador.client.rpc('upload_final_version', {
    p_piece: f.pieceId, p_image_path: await uploadPieceImage(f), p_caption: 'x',
  })
  expect(viewer.error?.code).toBe('42501')

  // imagem_texto needs image and caption together.
  expect((await uploadFinal(f, null)).error?.code).toBe('22023')
  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')
})

it('texto piece approved directly from base_em_revisao', async () => {
  const { f, v } = await approvedTexto()
  expect(await pieceOf(f.pieceId)).toEqual({ status: 'aprovada', approved_version_id: v.id })
})

it('rejects approval outside review status', async () => {
  const f = await createPieceFixture()
  const base = await inAcabamento(f)

  // acabamento is not a review status.
  const { error } = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  expect(error?.code).toBe('22023')
  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')

  // final_em_revisao only approves a final version.
  expect((await uploadFinal(f)).error).toBeNull()
  const wrongPhase = await approve(f.t.members.gestor.client, f.pieceId, base.id)
  expect(wrongPhase.error?.code).toBe('22023')
  expect((await pieceOf(f.pieceId)).status).toBe('final_em_revisao')
})

it('rejects approving version of another piece', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  await createAgentVersion(f)
  const foreign = await createAgentVersion(other)

  const { error } = await approve(f.t.members.gestor.client, f.pieceId, foreign.id)
  expect(error?.code).toBe('22023')
  expect(await pieceOf(f.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })
  expect(await pieceOf(other.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })
})

it('rejects approving own piece with a version of another team', async () => {
  const a = await createPieceFixture()
  const b = await createPieceFixture()
  const foreign = await createAgentVersion(a)
  await createAgentVersion(b)

  const { error } = await approve(b.t.members.gestor.client, b.pieceId, foreign.id)
  expect(error?.code).toBe('22023')
  expect(await pieceOf(a.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })
  expect(await pieceOf(b.pieceId)).toEqual({ status: 'base_em_revisao', approved_version_id: null })
})

it('step_back from gerando fails', async () => {
  const f = await createPieceFixture()
  const { error } = await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect(error?.message).toContain('no previous status')
  expect((await pieceOf(f.pieceId)).status).toBe('gerando')
  expect(await eventsOf(f.pieceId)).toEqual([])
})

it('step_back records status_changed event with author and clears the base approval', async () => {
  const f = await createPieceFixture()
  await inAcabamento(f)

  const viewer = await f.t.members.espectador.client.rpc('step_back', { p_piece: f.pieceId })
  expect(viewer.error?.code).toBe('42501')

  const { data, error } = await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect(error).toBeNull()
  expect(data).toMatchObject({ status: 'base_em_revisao', approved_version_id: null })

  expect((await eventsOf(f.pieceId)).at(-1)).toMatchObject({
    kind: 'status_changed', author_id: f.t.members.designer.userId,
    body: { from: 'acabamento', to: 'base_em_revisao' },
  })
})

it('only admin or gestor undo an approval; the base approval comes back', async () => {
  const f = await createPieceFixture()
  const { base } = await inAprovada(f)

  const designer = await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect(designer.error?.code).toBe('42501')
  expect((await pieceOf(f.pieceId)).status).toBe('aprovada')

  const { data, error } = await f.t.members.gestor.client.rpc('step_back', { p_piece: f.pieceId })
  expect(error).toBeNull()
  expect(data).toMatchObject({ status: 'final_em_revisao', approved_version_id: base.id })

  // From final_em_revisao the designer may step back again; the base stays approved.
  const again = await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect(again.data).toMatchObject({ status: 'acabamento', approved_version_id: base.id })
})

it('step_back on an approved texto piece returns to base_em_revisao', async () => {
  const { f, v } = await approvedTexto()

  const { data, error } = await f.t.members.gestor.client.rpc('step_back', { p_piece: f.pieceId })
  expect(error).toBeNull()
  expect(data).toMatchObject({ status: 'base_em_revisao', approved_version_id: null })

  // The piece can be approved again from there.
  const v2 = await createAgentVersion(f, { caption: 'Texto novo', image: false })
  expect((await approve(f.t.members.gestor.client, f.pieceId, v2.id)).data).toMatchObject({ status: 'aprovada', approved_version_id: v2.id })
  expect(v.id).not.toBe(v2.id)
})

it('update_caption creates a new edicao version with the same image', async () => {
  const f = await createPieceFixture()
  const v1 = await createAgentVersion(f)

  const { data: v2, error } = await f.t.members.designer.client.rpc('update_caption', { p_version: v1.id, p_caption: 'Legenda editada' })
  expect(error).toBeNull()
  expect(v2).toMatchObject({
    number: 2, origin: 'edicao', phase: 'base', image_path: v1.image_path, caption: 'Legenda editada', author_id: f.t.members.designer.userId,
  })
  expect((await eventsOf(f.pieceId)).at(-1)).toMatchObject({ kind: 'version_added', body: { version_id: v2.id, number: 2 } })

  const viewer = await f.t.members.espectador.client.rpc('update_caption', { p_version: v1.id, p_caption: 'x' })
  expect(viewer.error?.code).toBe('42501')
  const blank = await f.t.members.designer.client.rpc('update_caption', { p_version: v1.id, p_caption: '  ' })
  expect(blank.error?.code).toBe('22023')
})

it('update_caption rejects an approved version, even after a later approval', async () => {
  const f = await createPieceFixture()
  const { base, final } = await inAprovada(f)
  const edit = (id: string) => f.t.members.designer.client.rpc('update_caption', { p_version: id, p_caption: 'tarde demais' })

  // Back to final_em_revisao: the final version is under review again, but it was approved.
  await f.t.members.gestor.client.rpc('step_back', { p_piece: f.pieceId })
  expect((await edit(final.id)).error?.message).toContain('approved version cannot be edited')

  // Back to base_em_revisao: the base was approved once, so it stays locked.
  await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  await f.t.members.designer.client.rpc('step_back', { p_piece: f.pieceId })
  expect((await pieceOf(f.pieceId)).status).toBe('base_em_revisao')
  expect((await edit(base.id)).error?.message).toContain('approved version cannot be edited')
})

it('update_caption only works on the phase under review', async () => {
  const f = await createPieceFixture()
  const base = await createAgentVersion(f)
  await createAgentVersion(f)
  const unapproved = (await createAgentVersion(f)).id
  await approve(f.t.members.gestor.client, f.pieceId, base.id)

  // acabamento: nothing is under review.
  const { error } = await f.t.members.designer.client.rpc('update_caption', { p_version: unapproved, p_caption: 'x' })
  expect(error?.message).toContain('under review')
})

it('update_caption rejects imagem pieces', async () => {
  const f = await createPieceFixture(undefined, 'imagem')
  const v = await createAgentVersion(f, { caption: null })
  const { error } = await f.t.members.designer.client.rpc('update_caption', { p_version: v.id, p_caption: 'x' })
  expect(error?.message).toContain('imagem pieces have no caption')
})

it('members read versions of their team only', async () => {
  const f = await createPieceFixture()
  const b = await createTestTeam()
  const v = await createAgentVersion(f)

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
    p_piece: f.pieceId, p_image_path: await uploadTeamFile(`${b.teamId}/x.png`), p_caption: 'x',
  })
  expect(upload.error?.code).toBe('42501')
  expect((await b.members.admin.client.rpc('step_back', { p_piece: f.pieceId })).error?.code).toBe('42501')
  expect((await b.members.admin.client.rpc('update_caption', { p_version: base.id, p_caption: 'x' })).error?.code).toBe('42501')
  expect((await approve(b.members.gestor.client, f.pieceId, base.id)).error?.code).toBe('42501')

  expect((await pieceOf(f.pieceId)).status).toBe('acabamento')
})
