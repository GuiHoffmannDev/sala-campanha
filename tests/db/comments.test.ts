import type { SupabaseClient } from '@supabase/supabase-js'
import { createAgentVersion, createPieceFixture, createTestTeam, serviceClient, type PieceFixture } from '../helpers/supabase'

type Comment = {
  id: string; version_id: string; piece_id: string; team_id: string; author_id: string | null
  body: string; x: number | null; y: number | null; parent_id: string | null; resolved: boolean
}

/** Piece with one agent version; returns the fixture and the version id. */
async function withVersion(): Promise<{ f: PieceFixture; versionId: string }> {
  const f = await createPieceFixture()
  const version = await createAgentVersion(f, { caption: 'Legenda' })
  return { f, versionId: version.id }
}

function comment(c: SupabaseClient, f: PieceFixture, versionId: string, authorId: string, extra: Record<string, unknown> = {}) {
  return c.from('comments')
    .insert({ version_id: versionId, piece_id: f.pieceId, team_id: f.t.teamId, author_id: authorId, body: 'Logo menor aqui', ...extra })
    .select().single<Comment>()
}

it('designer comments on a point of the image', async () => {
  const { f, versionId } = await withVersion()
  const designer = f.t.members.designer
  const { data, error } = await comment(designer.client, f, versionId, designer.userId, { x: 0.25, y: 0.75 })
  expect(error).toBeNull()
  expect(data).toMatchObject({ version_id: versionId, author_id: designer.userId, x: 0.25, y: 0.75, parent_id: null, resolved: false })

  // Without coordinates it is a plain comment on the version.
  const plain = await comment(designer.client, f, versionId, designer.userId)
  expect(plain.error).toBeNull()
  expect(plain.data).toMatchObject({ x: null, y: null })

  // Every member of the team reads it, the espectador included.
  const { data: read } = await f.t.members.espectador.client.from('comments').select('id').eq('version_id', versionId)
  expect(read).toHaveLength(2)
})

it('rejects coordinates outside 0..1', async () => {
  const { f, versionId } = await withVersion()
  const d = f.t.members.designer
  for (const xy of [{ x: 1.5, y: 0.5 }, { x: 0.5, y: -0.1 }, { x: 0.5, y: null }, { x: null, y: 0.5 }]) {
    const { error } = await comment(d.client, f, versionId, d.userId, xy)
    expect(error?.code, JSON.stringify(xy)).toBe('23514')
  }
  // Edges are inside the image.
  expect((await comment(d.client, f, versionId, d.userId, { x: 0, y: 1 })).error).toBeNull()
})

it('rejects an empty body', async () => {
  const { f, versionId } = await withVersion()
  const d = f.t.members.designer
  const { error } = await comment(d.client, f, versionId, d.userId, { body: '  \n' })
  expect(error?.code).toBe('23514')
})

it('espectador cannot comment', async () => {
  const { f, versionId } = await withVersion()
  const e = f.t.members.espectador
  const { error } = await comment(e.client, f, versionId, e.userId)
  expect(error?.code).toBe('42501')
})

it('reply keeps thread via parent_id', async () => {
  const { f, versionId } = await withVersion()
  const { gestor, designer } = f.t.members
  const { data: root } = await comment(gestor.client, f, versionId, gestor.userId, { x: 0.5, y: 0.5 })
  const reply = await comment(designer.client, f, versionId, designer.userId, { parent_id: root!.id, body: 'Feito' })
  expect(reply.error).toBeNull()
  expect(reply.data?.parent_id).toBe(root!.id)

  const { data: thread } = await gestor.client.from('comments').select('body').eq('parent_id', root!.id)
  expect(thread).toEqual([{ body: 'Feito' }])
})

it('reply must stay on the same version', async () => {
  const { f, versionId } = await withVersion()
  const d = f.t.members.designer
  const { data: root } = await comment(d.client, f, versionId, d.userId)
  const v2 = await createAgentVersion(f)
  const { error } = await comment(d.client, f, v2.id, d.userId, { parent_id: root!.id })
  expect(error?.code).toBe('23503')
})

it('rejects comment authored as someone else', async () => {
  const { f, versionId } = await withVersion()
  const { designer, gestor } = f.t.members
  const { error } = await comment(designer.client, f, versionId, gestor.userId)
  expect(error?.code).toBe('42501')
})

it('rejects piece from another team', async () => {
  const { f, versionId } = await withVersion()
  const outsider = (await createTestTeam()).members.admin

  // Pointing at team A: RLS denies a non-member.
  expect((await comment(outsider.client, f, versionId, outsider.userId)).error?.code).toBe('42501')

  // Claiming its own team for team A's version: the composite FK refuses it.
  const { error } = await outsider.client.from('comments').insert({
    version_id: versionId, piece_id: f.pieceId, team_id: (await createTestTeam()).teamId, author_id: outsider.userId, body: 'x',
  })
  expect(error?.code).toMatch(/^(42501|23503)$/)

  // Version of another piece of the same team: the composite FK refuses it.
  const other = await createPieceFixture(f.t)
  const d = f.t.members.designer
  const wrongPiece = await d.client.from('comments').insert({
    version_id: versionId, piece_id: other.pieceId, team_id: f.t.teamId, author_id: d.userId, body: 'x',
  })
  expect(wrongPiece.error?.code).toBe('23503')

  // A non-member never reads the team's comments.
  await comment(d.client, f, versionId, d.userId)
  const { data } = await outsider.client.from('comments').select('id').eq('version_id', versionId)
  expect(data).toEqual([])
})

it('writers resolve a comment; only resolved can change', async () => {
  const { f, versionId } = await withVersion()
  const { designer, gestor, espectador } = f.t.members
  const { data: c } = await comment(designer.client, f, versionId, designer.userId)

  // espectador: RLS filters the row out, nothing changes.
  await espectador.client.from('comments').update({ resolved: true }).eq('id', c!.id)
  const { data: still } = await serviceClient().from('comments').select('resolved').eq('id', c!.id).single()
  expect(still?.resolved).toBe(false)

  const { error } = await gestor.client.from('comments').update({ resolved: true }).eq('id', c!.id)
  expect(error).toBeNull()
  const { data: after } = await serviceClient().from('comments').select('resolved').eq('id', c!.id).single()
  expect(after?.resolved).toBe(true)

  // Body, coordinates and author are not updatable by clients.
  const body = await designer.client.from('comments').update({ body: 'editado' }).eq('id', c!.id)
  expect(body.error?.code).toBe('42501')
  const author = await designer.client.from('comments').update({ author_id: gestor.userId }).eq('id', c!.id)
  expect(author.error?.code).toBe('42501')

  // No delete for clients.
  await designer.client.from('comments').delete().eq('id', c!.id)
  const { data: kept } = await serviceClient().from('comments').select('id').eq('id', c!.id)
  expect(kept).toHaveLength(1)
})

it('client cannot insert a comment already resolved', async () => {
  const { f, versionId } = await withVersion()
  const d = f.t.members.designer
  const { error } = await comment(d.client, f, versionId, d.userId, { resolved: true })
  expect(error?.code).toBe('42501')
})
