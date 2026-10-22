import { createTestTeam } from '../helpers/supabase'

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
})

it('client cannot update piece status directly', async () => {
  const t = await createTestTeam()
  const designer = t.members.designer.client
  const { data: c } = await designer.from('campaigns').insert({ team_id: t.teamId, name: 'Campanha' }).select().single()
  const { data: p } = await designer.from('pieces')
    .insert({ campaign_id: c!.id, team_id: t.teamId, title: 'Peça', kind: 'imagem' }).select().single()
  expect(p).not.toBeNull()

  await t.members.gestor.client.from('pieces').update({ status: 'aprovada' }).eq('id', p!.id)

  const { data: after } = await designer.from('pieces').select('status').eq('id', p!.id).single()
  expect(after!.status).toBe('gerando')
})

it('storage rejects upload outside own team prefix', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  const storage = a.members.gestor.client.storage.from('team-files')
  const file = new Blob(['png'], { type: 'image/png' })

  // Positive control: the own-team prefix is writable, so the rejection below is about the prefix.
  const { error: own } = await storage.upload(`${a.teamId}/ref.png`, file)
  expect(own).toBeNull()

  const { error } = await storage.upload(`${b.teamId}/ref.png`, file)
  expect(error).not.toBeNull()
})
