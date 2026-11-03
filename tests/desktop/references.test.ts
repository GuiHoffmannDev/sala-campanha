import { addReference, loadReferences } from '../../packages/desktop/src/data/references.ts'
import { downloadUrl, signedUrls, uploadImage } from '../../packages/desktop/src/data/files.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { createPieceFixture } from '../helpers/supabase'
import { file, PNG } from '../helpers/images'

const photo = () => new File([file(PNG)], 'Produto.png', { type: 'image/png' })

it('designer uploads a reference and everyone in the team lists it', async () => {
  const f = await createPieceFixture()
  const reference = await addReference(f.t.members.designer.client, {
    teamId: f.t.teamId, campaignId: f.campaignId, file: photo(),
  })
  expect(reference).toMatchObject({ campaign_id: f.campaignId, team_id: f.t.teamId, original_name: 'Produto.png' })
  expect(reference.storage_path).toMatch(new RegExp(`^${f.t.teamId}/${f.campaignId}/[0-9a-f-]{36}\\.png$`))
  for (const member of Object.values(f.t.members)) {
    expect(await loadReferences(member.client, f.campaignId)).toEqual([reference])
  }
  const client = f.t.members.espectador.client
  const urls = await signedUrls(client, [reference.storage_path])
  expect((await fetch(urls[reference.storage_path]!)).status).toBe(200)
  const url = await downloadUrl(client, reference.storage_path, 'Produto.png')
  const downloaded = await fetch(url)
  expect(downloaded.status).toBe(200)
  expect(downloaded.headers.get('content-disposition')).toContain('Produto.png')
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(file(PNG))
  // A second upload cannot replace a photo already used as a reference.
  await expect(uploadImage(f.t.members.designer.client, reference.storage_path, photo())).rejects.toBeDefined()
})

it('espectador cannot upload', async () => {
  const f = await createPieceFixture()
  const error = await addReference(f.t.members.espectador.client, {
    teamId: f.t.teamId, campaignId: f.campaignId, file: photo(),
  }).catch((e: unknown) => e)
  expect(friendlyError(error)).toBe('Você não tem permissão para isso.')
  expect(await loadReferences(f.t.members.admin.client, f.campaignId)).toEqual([])
})

it('another team cannot list it', async () => {
  const a = await createPieceFixture()
  const b = await createPieceFixture()
  const reference = await addReference(a.t.members.designer.client, {
    teamId: a.t.teamId, campaignId: a.campaignId, file: photo(),
  })
  expect(await loadReferences(b.t.members.admin.client, a.campaignId)).toEqual([])
  expect((await signedUrls(b.t.members.admin.client, [reference.storage_path]))[reference.storage_path]).toBeUndefined()
  await expect(downloadUrl(b.t.members.admin.client, reference.storage_path, 'Produto.png')).rejects.toBeDefined()
})

it('rejects an invalid image before contacting storage or inserting a reference', async () => {
  const f = await createPieceFixture()
  const input = { teamId: f.t.teamId, campaignId: f.campaignId,
    file: new File(['pdf'], 'Manual.pdf', { type: 'application/pdf' }) }
  await expect(addReference(f.t.members.designer.client, input)).rejects.toThrow('Use uma imagem PNG, JPG ou WebP.')
  expect(await loadReferences(f.t.members.designer.client, f.campaignId)).toEqual([])
})
