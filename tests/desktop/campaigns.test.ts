import { randomUUID } from 'node:crypto'
import {
  createCampaign, createPiece, loadCampaigns, loadPieces, loadThumbnails, renamePiece, resolveRoute, subscribeLists,
} from '../../packages/desktop/src/data/campaigns.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { signedUrls } from '../../packages/desktop/src/data/files.ts'
import { closeChannels, waitFor, warmUpRealtime } from '../helpers/realtime'
import { createAgentVersion, createPieceFixture, createTestTeam, serviceClient, uploadTeamFile } from '../helpers/supabase'

const NOT_FOUND = 'Piece not found or access denied.'
const NO_ROUTE = { campaignId: null, pieceId: null }

afterEach(closeChannels)

it('designer creates a campaign and a piece and renames it', async () => {
  const t = await createTestTeam()
  const designer = t.members.designer.client

  const first = await createCampaign(designer, t.teamId, '  Black Friday  ')
  expect(first).toMatchObject({ team_id: t.teamId, name: 'Black Friday' })
  const second = await createCampaign(designer, t.teamId, 'Natal')
  expect((await loadCampaigns(designer, t.teamId)).map((c) => c.id)).toEqual([first.id, second.id])

  const piece = await createPiece(designer, { campaignId: first.id, teamId: t.teamId, title: ' Banner ', kind: 'imagem' })
  expect(piece).toMatchObject({
    campaign_id: first.id, team_id: t.teamId, title: 'Banner', kind: 'imagem', status: 'gerando', approved_version_id: null,
  })

  await renamePiece(designer, piece.id, ' Banner Instagram ')
  expect(await loadPieces(designer, first.id)).toEqual([{ ...piece, title: 'Banner Instagram' }])
  expect(await loadPieces(designer, second.id)).toEqual([])
})

it('espectador gets the friendly permission error', async () => {
  const f = await createPieceFixture()
  const viewer = f.t.members.espectador.client
  const permission = 'You do not have permission to do this.'

  const campaign = await createCampaign(viewer, f.t.teamId, 'Não pode').catch((e: unknown) => e)
  expect(friendlyError(campaign)).toBe(permission)
  const piece = await createPiece(viewer, { campaignId: f.campaignId, teamId: f.t.teamId, title: 'Não pode', kind: 'texto' })
    .catch((e: unknown) => e)
  expect(friendlyError(piece)).toBe(permission)
  // RLS hides the row from an update instead of failing it; the app must still say no.
  const rename = await renamePiece(viewer, f.pieceId, 'Não pode').catch((e: unknown) => e)
  expect(friendlyError(rename)).toBe('You cannot edit this piece.')

  const { data } = await serviceClient().from('pieces').select('title').eq('id', f.pieceId).single()
  expect(data?.title).toBe('Peça de teste')
})

it('thumbnails use the newest version with an image', async () => {
  const f = await createPieceFixture(undefined, 'imagem')
  const other = await createPieceFixture(f.t, 'imagem')
  await createAgentVersion(f, { caption: null })
  const newest = await createAgentVersion(f, { caption: null })
  // A piece of another campaign, and a piece of this campaign without versions, are not in the map.
  await createAgentVersion(other, { caption: null })
  const { data: empty } = await serviceClient().from('pieces')
    .insert({ campaign_id: f.campaignId, team_id: f.t.teamId, title: 'Sem versão', kind: 'imagem' }).select('id').single()

  const thumbnails = await loadThumbnails(f.t.members.espectador.client, f.campaignId)
  expect(thumbnails).toEqual({ [f.pieceId]: newest.image_path })
  expect(empty?.id && thumbnails[empty.id]).toBeFalsy()
})

it('signedUrls signs every path in one call', async () => {
  const t = await createTestTeam()
  const paths = await Promise.all([1, 2].map(() => uploadTeamFile(`${t.teamId}/${randomUUID()}/${randomUUID()}.png`)))

  const urls = await signedUrls(t.members.espectador.client, paths)
  expect(Object.keys(urls).sort()).toEqual([...paths].sort())
  const image = await fetch(urls[paths[0]!]!)
  expect(image.status).toBe(200)
  expect(await signedUrls(t.members.espectador.client, [])).toEqual({})
})

it('a link to a piece resolves to its campaign and workspace', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const client = f.t.members.espectador.client

  expect(await resolveRoute(client, { campaignId: f.campaignId, pieceId: f.pieceId }))
    .toEqual({ route: { campaignId: f.campaignId, pieceId: f.pieceId }, teamId: f.t.teamId, notice: null })
  expect(await resolveRoute(client, { campaignId: f.campaignId, pieceId: null }))
    .toEqual({ route: { campaignId: f.campaignId, pieceId: null }, teamId: f.t.teamId, notice: null })
  // A piece moved under another campaign of the link: the piece wins.
  expect(await resolveRoute(client, { campaignId: other.campaignId, pieceId: f.pieceId }))
    .toEqual({ route: { campaignId: f.campaignId, pieceId: f.pieceId }, teamId: f.t.teamId, notice: null })
  expect(await resolveRoute(client, NO_ROUTE)).toEqual({ route: NO_ROUTE, teamId: null, notice: null })
})

it("a link to another team's piece resolves to no route with a notice", async () => {
  const a = await createPieceFixture()
  const b = await createPieceFixture()
  const client = b.t.members.admin.client
  const missing = { route: NO_ROUTE, teamId: null, notice: NOT_FOUND }

  expect(await resolveRoute(client, { campaignId: a.campaignId, pieceId: a.pieceId })).toEqual(missing)
  expect(await resolveRoute(client, { campaignId: a.campaignId, pieceId: null })).toEqual(missing)
  // Own campaign, someone else's piece: still nothing about the piece leaks.
  expect(await resolveRoute(client, { campaignId: b.campaignId, pieceId: a.pieceId })).toEqual(missing)
  expect(await resolveRoute(client, { campaignId: randomUUID(), pieceId: randomUUID() })).toEqual(missing)
})

it('a link to a campaign in another of my workspaces returns that workspace', async () => {
  const mine = await createTestTeam()
  const other = await createPieceFixture()
  const me = mine.members.designer
  const { error } = await serviceClient().from('team_members')
    .insert({ team_id: other.t.teamId, user_id: me.userId, role: 'espectador', display_name: 'designer' })
  expect(error).toBeNull()

  expect(await resolveRoute(me.client, { campaignId: other.campaignId, pieceId: null }))
    .toEqual({ route: { campaignId: other.campaignId, pieceId: null }, teamId: other.t.teamId, notice: null })
  expect(await resolveRoute(me.client, { campaignId: other.campaignId, pieceId: other.pieceId }))
    .toEqual({ route: { campaignId: other.campaignId, pieceId: other.pieceId }, teamId: other.t.teamId, notice: null })
})

describe('live lists', () => {
  beforeAll(warmUpRealtime, 40_000)

  it('subscribeLists reports new campaigns and new or renamed pieces of the open campaign', async () => {
    const f = await createPieceFixture()
    const designer = f.t.members.designer.client
    let changes = 0
    // Realtime checks RLS with the user's JWT.
    await designer.realtime.setAuth()
    const stop = subscribeLists(designer, f.t.teamId, f.campaignId, () => { changes++ })
    // Wait until the channel is live before changing anything.
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000
      const tick = () => {
        if (designer.getChannels().some((c) => c.state === 'joined')) resolve()
        else if (Date.now() > deadline) reject(new Error('lists channel did not join'))
        else setTimeout(tick, 50)
      }
      tick()
    })
    // Realtime may still deliver the fixture's own inserts, made just before the channel joined.
    await new Promise((r) => setTimeout(r, 1_500))
    changes = 0

    await createCampaign(designer, f.t.teamId, 'Nova')
    await waitFor(() => changes >= 1)
    expect(changes).toBe(1)
    await createPiece(designer, { campaignId: f.campaignId, teamId: f.t.teamId, title: 'New piece', kind: 'texto' })
    await waitFor(() => changes >= 2)
    await renamePiece(designer, f.pieceId, 'Renomeada')
    await waitFor(() => changes >= 3)
    expect(changes).toBe(3)

    stop()
    expect(designer.getChannels()).toEqual([])
  }, 40_000)
})
