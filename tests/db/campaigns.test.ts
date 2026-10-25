import { randomUUID } from 'node:crypto'
import { createPieceFixture, createTestTeam, serviceClient, uploadTeamFile } from '../helpers/supabase'

const png = () => new Blob(['png'], { type: 'image/png' })

it('designer creates campaign and piece; espectador cannot', async () => {
  const t = await createTestTeam()
  const { data: c, error } = await t.members.designer.client.from('campaigns')
    .insert({ team_id: t.teamId, name: 'Black Friday 2026' }).select().single()
  expect(error).toBeNull()
  const { error: e2 } = await t.members.espectador.client.from('campaigns').insert({ team_id: t.teamId, name: 'x' })
  expect(e2).not.toBeNull()
  const { data: p } = await t.members.designer.client.from('pieces')
    .insert({ campaign_id: c!.id, team_id: t.teamId, title: 'Banner Instagram', kind: 'imagem_texto' }).select().single()
  expect(p!.status).toBe('gerando')
  expect(p!.created_by).toBe(t.members.designer.userId)
})

it('client cannot update piece status directly', async () => {
  const t = await createTestTeam()
  const designer = t.members.designer.client
  const { data: c } = await designer.from('campaigns').insert({ team_id: t.teamId, name: 'Campanha' }).select().single()
  const { data: p } = await designer.from('pieces')
    .insert({ campaign_id: c!.id, team_id: t.teamId, title: 'Peça', kind: 'imagem' }).select().single()
  expect(p).not.toBeNull()

  const { error } = await t.members.gestor.client.from('pieces').update({ status: 'aprovada' }).eq('id', p!.id)
  expect(error?.code).toBe('42501')

  const { data: after } = await designer.from('pieces').select('status').eq('id', p!.id).single()
  expect(after!.status).toBe('gerando')
})

it('client cannot set approved_version_id or insert an approved piece', async () => {
  const f = await createPieceFixture()
  const gestor = f.t.members.gestor.client

  const update = await gestor.from('pieces').update({ approved_version_id: randomUUID() }).eq('id', f.pieceId)
  expect(update.error?.code).toBe('42501')

  const insert = await gestor.from('pieces')
    .insert({ campaign_id: f.campaignId, team_id: f.t.teamId, title: 'x', kind: 'imagem', status: 'aprovada' })
  expect(insert.error?.code).toBe('42501')
})

it('writers rename pieces; espectador cannot', async () => {
  const f = await createPieceFixture()
  const viewer = await f.t.members.espectador.client.from('pieces').update({ title: 'Novo' }).eq('id', f.pieceId).select()
  // RLS filters the row for a non-writer: nothing is updated.
  expect(viewer.data).toEqual([])

  const designer = await f.t.members.designer.client.from('pieces').update({ title: 'Novo' }).eq('id', f.pieceId).select('title')
  expect(designer.error).toBeNull()
  expect(designer.data).toEqual([{ title: 'Novo' }])
})

it('deleting an author keeps their campaign and piece', async () => {
  const t = await createTestTeam()
  const designer = t.members.designer
  const { data: c } = await designer.client.from('campaigns').insert({ team_id: t.teamId, name: 'Campanha' }).select().single()
  const { data: p } = await designer.client.from('pieces')
    .insert({ campaign_id: c!.id, team_id: t.teamId, title: 'Peça', kind: 'imagem' }).select().single()

  expect((await serviceClient().auth.admin.deleteUser(designer.userId)).error).toBeNull()

  const { data: campaign } = await serviceClient().from('campaigns').select('created_by').eq('id', c!.id).single()
  const { data: piece } = await serviceClient().from('pieces').select('created_by').eq('id', p!.id).single()
  expect(campaign).toEqual({ created_by: null })
  expect(piece).toEqual({ created_by: null })
})

it('storage rejects upload outside own team prefix', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  const storage = a.members.gestor.client.storage.from('team-files')

  // Positive control: the own-team prefix is writable, so the rejection below is about the prefix.
  const { error: own } = await storage.upload(`${a.teamId}/ref.png`, png())
  expect(own).toBeNull()

  const { error } = await storage.upload(`${b.teamId}/ref.png`, png())
  expect(error).not.toBeNull()
})

it('storage rejects an uppercase team prefix', async () => {
  const t = await createTestTeam()
  const { error } = await t.members.gestor.client.storage.from('team-files')
    .upload(`${t.teamId.toUpperCase()}/ref.png`, png())
  expect(error).not.toBeNull()
})

it('espectador cannot upload and other teams cannot read', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  const path = await uploadTeamFile(`${a.teamId}/foto.png`)

  const viewer = await a.members.espectador.client.storage.from('team-files').upload(`${a.teamId}/v.png`, png())
  expect(viewer.error).not.toBeNull()

  // Positive control: the team reads its own file.
  expect((await a.members.espectador.client.storage.from('team-files').download(path)).error).toBeNull()
  expect((await b.members.admin.client.storage.from('team-files').download(path)).error).not.toBeNull()
  const { data: listed } = await b.members.admin.client.storage.from('team-files').list(a.teamId)
  expect(listed ?? []).toEqual([])
})

it('storage is write-once for members: no overwrite, move or delete', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  const path = await uploadTeamFile(`${a.teamId}/final.png`)
  const storage = a.members.designer.client.storage.from('team-files')

  expect((await storage.upload(path, png(), { upsert: true })).error).not.toBeNull()
  expect((await storage.move(path, `${a.teamId}/moved.png`)).error).not.toBeNull()
  expect((await storage.move(path, `${b.teamId}/stolen.png`)).error).not.toBeNull()
  await storage.remove([path])

  // remove() reports success with an empty list when RLS hides the delete; check the object itself.
  const { data } = await serviceClient().storage.from('team-files').list(a.teamId)
  expect(data?.map((o) => o.name)).toEqual(['final.png'])
})

it('reference asset needs an uploaded file', async () => {
  const f = await createPieceFixture()
  const designer = f.t.members.designer.client
  const row = (storage_path: string) =>
    ({ campaign_id: f.campaignId, team_id: f.t.teamId, storage_path, original_name: 'produto.png' })

  const missing = await designer.from('reference_assets').insert(row(`${f.t.teamId}/nao-existe.png`))
  expect(missing.error?.code).toBe('42501')

  // A file that exists in another team's folder gets the same answer as a missing one.
  const b = await createTestTeam()
  const foreign = await designer.from('reference_assets').insert(row(await uploadTeamFile(`${b.teamId}/produto.png`)))
  expect(foreign.error).toMatchObject({ code: missing.error?.code, message: missing.error?.message })

  const path = await uploadTeamFile(`${f.t.teamId}/produto.png`)
  const { data, error } = await designer.from('reference_assets').insert(row(path)).select('uploaded_by').single()
  expect(error).toBeNull()
  expect(data).toEqual({ uploaded_by: f.t.members.designer.userId })
})

it('bucket accepts only PNG, JPG and WebP up to 25 MB', async () => {
  const t = await createTestTeam()
  const storage = t.members.designer.client.storage.from('team-files')
  for (const [name, type] of [['a.svg', 'image/svg+xml'], ['a.html', 'text/html']] as const) {
    const { error } = await storage.upload(`${t.teamId}/${name}`, new Blob(['<svg/>'], { type }), { contentType: type })
    expect(error, type).not.toBeNull()
  }
  // Positive control: an allowed type from the same member goes through.
  expect((await storage.upload(`${t.teamId}/ok.webp`, new Blob(['x'], { type: 'image/webp' }), { contentType: 'image/webp' })).error).toBeNull()

  const { data } = await serviceClient().storage.getBucket('team-files')
  expect(data).toMatchObject({ file_size_limit: 26214400, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] })
})
