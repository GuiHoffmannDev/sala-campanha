import { addComment, loadComments, setResolved } from '../../packages/desktop/src/data/comments.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { captionExcerpt } from '../../packages/desktop/src/lib/excerpt.ts'
import { createAgentVersion, createPieceFixture, createTestTeam } from '../helpers/supabase'

it('pins a comment on the image and replies to it', async () => {
  const f = await createPieceFixture()
  const v = await createAgentVersion(f)
  const { designer, gestor, espectador } = f.t.members
  const input = { teamId: f.t.teamId, pieceId: f.pieceId, versionId: v.id, parentId: null }
  const root = await addComment(designer.client, { ...input, body: 'Logo menor aqui', target: { x: 0.25, y: 0.5 } })
  expect(root).toMatchObject({ author_id: designer.userId, x: 0.25, y: 0.5, resolved: false, parent_id: null })
  const reply = await addComment(gestor.client, { ...input, body: 'Combinado', target: null, parentId: root.id })
  expect(reply).toMatchObject({ author_id: gestor.userId, parent_id: root.id, x: null, y: null })
  expect(await loadComments(espectador.client, f.pieceId)).toEqual([root, reply])
  const { data: events } = await designer.client.from('session_events').select('to_agent, delivery')
    .eq('piece_id', f.pieceId).eq('kind', 'comment')
  expect(events).toEqual([{ to_agent: false, delivery: 'not_applicable' }, { to_agent: false, delivery: 'not_applicable' }])
})

it('loads all comments and replies past the 1000-row page limit in stable order', async () => {
  const f = await createPieceFixture()
  const version = await createAgentVersion(f)
  const client = f.t.members.designer.client
  const input = { teamId: f.t.teamId, pieceId: f.pieceId, versionId: version.id, target: null, parentId: null }
  const root = await addComment(client, { ...input, body: 'Raiz' })
  const { data, error } = await client.from('comments').insert(Array.from({ length: 1_000 }, () => ({
    team_id: f.t.teamId, piece_id: f.pieceId, version_id: version.id, body: 'Outro comentário',
  }))).select('id')
  expect(error).toBeNull()
  const ids = data!.map((comment: { id: string }) => comment.id).sort()
  const reply = await addComment(client, { ...input, body: 'Resposta após o limite', parentId: root.id })

  const comments = await loadComments(f.t.members.espectador.client, f.pieceId)
  expect(comments.map((comment) => comment.id)).toEqual([root.id, ...ids, reply.id])
  expect(comments.at(-1)).toEqual(reply)
})

it('comments a caption excerpt with an emoji before it', async () => {
  const f = await createPieceFixture()
  const v = await createAgentVersion(f, { caption: 'Oi 👋 mundo' })
  const comment = await addComment(f.t.members.designer.client, {
    teamId: f.t.teamId, pieceId: f.pieceId, versionId: v.id, parentId: null,
    body: 'Trocar esta palavra', target: captionExcerpt('Oi 👋 mundo', 6, 11),
  })
  expect(comment).toMatchObject({ text_start: 5, text_end: 10, quote: 'mundo', x: null, y: null })
})

it('resolves a thread', async () => {
  const f = await createPieceFixture()
  const v = await createAgentVersion(f)
  const client = f.t.members.designer.client
  const root = await addComment(client, { teamId: f.t.teamId, pieceId: f.pieceId, versionId: v.id,
    body: 'Conferir', target: null, parentId: null })
  await setResolved(client, root.id, true)
  expect((await loadComments(client, f.pieceId))[0]?.resolved).toBe(true)
  await setResolved(client, root.id, false)
  expect((await loadComments(client, f.pieceId))[0]?.resolved).toBe(false)
})

it('espectador gets the friendly error', async () => {
  const f = await createPieceFixture()
  const v = await createAgentVersion(f)
  const input = { teamId: f.t.teamId, pieceId: f.pieceId, versionId: v.id, body: 'Sem permissão', target: null, parentId: null }
  const error = await addComment(f.t.members.espectador.client, input).catch((e: unknown) => e)
  expect(friendlyError(error)).toBe('Você não tem permissão para isso.')
  const root = await addComment(f.t.members.designer.client, input)
  const resolveError = await setResolved(f.t.members.espectador.client, root.id, true).catch((e: unknown) => e)
  expect(friendlyError(resolveError)).toBe('Você não tem permissão para isso.')
  expect((await loadComments(f.t.members.designer.client, f.pieceId))[0]?.resolved).toBe(false)
})

it('cannot read or resolve another workspace’s comments', async () => {
  const f = await createPieceFixture()
  const v = await createAgentVersion(f)
  const root = await addComment(f.t.members.designer.client, { teamId: f.t.teamId, pieceId: f.pieceId,
    versionId: v.id, body: 'Privado', target: null, parentId: null })
  const outsider = (await createTestTeam()).members.admin.client
  expect(await loadComments(outsider, f.pieceId)).toEqual([])
  await expect(setResolved(outsider, root.id, true)).rejects.toBeDefined()
  expect((await loadComments(f.t.members.designer.client, f.pieceId))[0]?.resolved).toBe(false)
})
