import { approveVersion, loadVersions, stepBack, updateCaption, uploadFinalVersion } from '../../packages/desktop/src/data/versions.ts'
import { loadPieces } from '../../packages/desktop/src/data/campaigns.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { createAgentVersion, createPieceFixture } from '../helpers/supabase'
import { file, PNG } from '../helpers/images'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Piece } from '../../packages/desktop/src/data/campaigns.ts'

const photo = () => new File([file(PNG)], 'Final.png', { type: 'image/png' })

it('designer uploads the final after the base is approved, and the gestor approves it', async () => {
  const f = await createPieceFixture()
  const { designer, gestor } = f.t.members
  const base = await createAgentVersion(f)
  await approveVersion(gestor.client, f.pieceId, base.id)
  const [piece] = await loadPieces(designer.client, f.campaignId)
  const final = await uploadFinalVersion(designer.client, { piece: piece!, file: photo(), caption: 'Legenda final' })
  expect(final).toMatchObject({ number: 2, origin: 'upload', phase: 'final', caption: 'Legenda final', author_id: designer.userId })
  expect(final.image_path).toMatch(new RegExp(`^${f.t.teamId}/${f.pieceId}/[0-9a-f-]{36}\\.png$`))
  expect((await loadPieces(designer.client, f.campaignId))[0]?.status).toBe('final_em_revisao')
  await approveVersion(gestor.client, f.pieceId, final.id)
  expect((await loadPieces(gestor.client, f.campaignId))[0]).toMatchObject({ status: 'aprovada', approved_version_id: final.id })
  expect((await loadVersions(designer.client, f.pieceId)).map((v) => v.id)).toEqual([base.id, final.id])
})

it('uploading a final before approval gives the friendly message', async () => {
  const f = await createPieceFixture()
  await createAgentVersion(f)
  const client = f.t.members.designer.client
  const [piece] = await loadPieces(client, f.campaignId)
  const error = await uploadFinalVersion(client, { piece: piece!, file: photo(), caption: 'Final' }).catch((e: unknown) => e)
  expect(friendlyError(error)).toBe('The final version can only be uploaded after the base is approved.')
  expect(await loadVersions(client, f.pieceId)).toHaveLength(1)
})

it('designer cannot undo an approval', async () => {
  const f = await createPieceFixture(undefined, 'texto')
  const base = await createAgentVersion(f, { image: false })
  await approveVersion(f.t.members.gestor.client, f.pieceId, base.id)
  const error = await stepBack(f.t.members.designer.client, f.pieceId).catch((e: unknown) => e)
  expect(friendlyError(error)).toBe('Only an admin or manager can undo an approval.')
  expect((await loadPieces(f.t.members.designer.client, f.campaignId))[0]?.status).toBe('aprovada')
  await stepBack(f.t.members.gestor.client, f.pieceId)
  expect((await loadPieces(f.t.members.designer.client, f.campaignId))[0]?.status).toBe('base_em_revisao')
})

it('caption edit creates an edicao version', async () => {
  const f = await createPieceFixture()
  const base = await createAgentVersion(f)
  const edited = await updateCaption(f.t.members.designer.client, base.id, 'Legenda editada 🦜')
  expect(edited).toMatchObject({ number: 2, origin: 'edicao', phase: 'base', caption: 'Legenda editada 🦜', image_path: base.image_path })
  expect((await loadVersions(f.t.members.designer.client, f.pieceId))[0]?.caption).toBe('Legenda base')
})

it('rejects missing, unsupported and oversized final images before contacting storage', async () => {
  const client = { storage: { from: vi.fn() }, rpc: vi.fn() } as unknown as SupabaseClient
  const piece = { kind: 'imagem', team_id: 't', id: 'p' } as Piece
  for (const [file, message] of [
    [null, 'Choose a PNG, JPG or WebP image.'],
    [new File(['pdf'], 'Manual.pdf', { type: 'application/pdf' }), 'Use a PNG, JPG or WebP image.'],
    [{ type: 'image/png', size: 26_214_401 } as File, 'The image is larger than 25 MB.'],
  ] as const) {
    await expect(uploadFinalVersion(client, { piece, file, caption: null })).rejects.toThrow(message)
  }
  expect(client.storage.from).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
})
