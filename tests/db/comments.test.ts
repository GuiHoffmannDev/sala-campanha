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
  const outsiderTeam = await createTestTeam()
  const outsider = outsiderTeam.members.admin

  // Pointing at team A: RLS denies a non-member.
  expect((await comment(outsider.client, f, versionId, outsider.userId)).error?.code).toBe('42501')

  // Declaring its own team for team A's piece: RLS passes (writer of its team),
  // so the composite (piece_id, team_id) FK must be what refuses it.
  const { error } = await outsider.client.from('comments').insert({
    version_id: versionId, piece_id: f.pieceId, team_id: outsiderTeam.teamId, author_id: outsider.userId, body: 'x',
  })
  expect(error?.code).toBe('23503')

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
  const point = await designer.client.from('comments').update({ x: 0.1, y: 0.1 }).eq('id', c!.id)
  expect(point.error?.code).toBe('42501')
  const excerpt = await designer.client.from('comments').update({ text_start: 0 }).eq('id', c!.id)
  expect(excerpt.error?.code).toBe('42501')

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

it('comments on a caption excerpt', async () => {
  const { f, versionId } = await withVersion() // caption 'Legenda'
  const d = f.t.members.designer
  const { data, error } = await comment(d.client, f, versionId, d.userId, { text_start: 0, text_end: 3, quote: 'Leg' })
  expect(error).toBeNull()
  expect(data).toMatchObject({ text_start: 0, text_end: 3, quote: 'Leg', x: null, y: null })

  for (const bad of [
    { text_start: 2, text_end: 20, quote: 'genda' }, // past the end of the caption
    { text_start: 0, text_end: 3, quote: 'Lxx' }, // quote differs from the caption
  ]) {
    const { error: e } = await comment(d.client, f, versionId, d.userId, bad)
    expect(e?.code, JSON.stringify(bad)).toBe('22023')
  }

  // Malformed ranges or mixed targets break the table check.
  for (const bad of [
    { text_start: 3, text_end: 3, quote: '' },
    { text_start: 0, text_end: 3 },
    { text_start: 0, text_end: 3, quote: 'Leg', x: 0.5, y: 0.5 },
  ]) {
    const { error: e } = await comment(d.client, f, versionId, d.userId, bad)
    expect(e?.code, JSON.stringify(bad)).toBe('23514')
  }
})

it('excerpt needs a version with a caption', async () => {
  const f = await createPieceFixture(undefined, 'imagem')
  const v = await createAgentVersion(f, { caption: null })
  const d = f.t.members.designer
  const { error } = await comment(d.client, f, v.id, d.userId, { text_start: 0, text_end: 1, quote: 'L' })
  expect(error?.code).toBe('22023')
})

it('threads are one level deep and replies have no target', async () => {
  const { f, versionId } = await withVersion()
  const { gestor, designer } = f.t.members
  const { data: root } = await comment(gestor.client, f, versionId, gestor.userId, { x: 0.5, y: 0.5 })
  const { data: reply } = await comment(designer.client, f, versionId, designer.userId, { parent_id: root!.id })

  const nested = await comment(gestor.client, f, versionId, gestor.userId, { parent_id: reply!.id })
  expect(nested.error?.message).toContain('root comment')

  const pinned = await comment(designer.client, f, versionId, designer.userId, { parent_id: root!.id, x: 0.1, y: 0.1 })
  expect(pinned.error?.message).toContain('no target')
  const quoted = await comment(designer.client, f, versionId, designer.userId, { parent_id: root!.id, text_start: 0, text_end: 1, quote: 'L' })
  expect(quoted.error?.message).toContain('no target')
})

it('a comment adds a comment event visible to its team only', async () => {
  const { f, versionId } = await withVersion()
  const other = await createTestTeam()
  const d = f.t.members.designer
  const { data: c } = await comment(d.client, f, versionId, d.userId)

  const { data: events } = await f.t.members.espectador.client.from('session_events')
    .select('kind, author_id, body, to_agent, delivery').eq('piece_id', f.pieceId).eq('kind', 'comment')
  expect(events).toEqual([{
    kind: 'comment', author_id: d.userId, to_agent: false, delivery: 'not_applicable',
    body: { comment_id: c!.id, version_id: versionId, parent_id: null },
  }])

  const { data: foreign } = await other.members.admin.client.from('session_events').select('id').eq('piece_id', f.pieceId)
  expect(foreign).toEqual([])
})

it('excerpt offsets count code points, not UTF-16 units', async () => {
  const f = await createPieceFixture()
  // Text after 'hoje' keeps the UTF-16 range inside the caption, so the wrong
  // range fails on the quote, not on the caption length.
  const caption = 'Oferta 🔥 hoje mesmo'
  const v = await createAgentVersion(f, { caption })
  const d = f.t.members.designer
  const start = Array.from(caption).indexOf('h') // 9; in UTF-16 'hoje' starts at 10

  const { error } = await comment(d.client, f, v.id, d.userId, { text_start: start, text_end: start + 4, quote: 'hoje' })
  expect(error).toBeNull()
  const utf16 = caption.indexOf('hoje')
  expect(utf16).toBe(start + 1)
  expect(utf16 + 4).toBeLessThanOrEqual(Array.from(caption).length)
  const wrong = await comment(d.client, f, v.id, d.userId, { text_start: utf16, text_end: utf16 + 4, quote: 'hoje' })
  expect(wrong.error?.code).toBe('22023')
  expect(wrong.error?.message).toContain('excerpt does not match')
})
