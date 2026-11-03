// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { loadEvents, type PieceHandlers } from '../../packages/desktop/src/data/events.ts'
import { loadVersions, type Version } from '../../packages/desktop/src/data/versions.ts'
import { loadPieces } from '../../packages/desktop/src/data/campaigns.ts'
import { addComment, loadComments, setResolved } from '../../packages/desktop/src/data/comments.ts'
import { Chat } from '../../packages/desktop/src/ui/Chat.tsx'
import { createAgentVersion, createPieceFixture, serviceClient, TEST_EXECUTOR } from '../helpers/supabase'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

// The handlers Chat passed to the last subscribePiece, so a test can play the channel.
const live = vi.hoisted(() => ({ handlers: null as PieceHandlers | null }))

// Node's WebSocket rejects jsdom's events; the live channel is tested in events.test.ts.
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => {
  const mod = await original<typeof import('../../packages/desktop/src/data/events.ts')>()
  return {
    ...mod,
    // Real by default; a test can hold one load open.
    loadEvents: vi.fn(mod.loadEvents),
    subscribePiece: (_client: unknown, _pieceId: string, h: PieceHandlers) => {
      live.handlers = h
      return () => {}
    },
  }
})

// Real, but observable: a test can wait for the mount's load to finish.
vi.mock('../../packages/desktop/src/data/versions.ts', async (original) => {
  const mod = await original<typeof import('../../packages/desktop/src/data/versions.ts')>()
  return { ...mod, loadVersions: vi.fn(mod.loadVersions) }
})

it('shows messages with author and initials, and the agent card with image, caption and a collapsed prompt', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const gestor = f.t.members.gestor
  const version = await createAgentVersion(f, { caption: 'Promoção de Natal' })
  // The source message createAgentVersion posted and claimed; the agent answers it.
  const { data: source } = await serviceClient().from('session_events').select('id')
    .eq('piece_id', f.pieceId).eq('kind', 'user_message').single()
  const { error } = await serviceClient().rpc('add_agent_event', {
    p_source_event: source!.id, p_executor: TEST_EXECUTOR, p_kind: 'agent_result',
    p_body: { message_ids: [source!.id], round: 1, version_id: version.id, version_number: 1, image_prompt: 'um pinheiro dourado' },
  })
  expect(error).toBeNull()
  await gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Agora mais claro' })

  const members = [
    { userId: gestor.userId, displayName: 'Gil Prado', role: 'gestor' as const },
    { userId: f.t.members.designer.userId, displayName: 'Dora', role: 'designer' as const },
  ]
  render(<Chat client={f.t.members.designer.client} piece={(await loadPieces(gestor.client, f.campaignId))[0]!}
    role="designer" members={members} />)

  const latest = (await screen.findByText('Agora mais claro')).closest('li')!
  expect(within(latest).getByText('Gil Prado')).toBeTruthy()
  expect(within(latest).getByText('GP')).toBeTruthy()
  expect(within(latest).getByText('na fila')).toBeTruthy()
  // The message the agent took stays claimed until the executor closes it.
  const answered = screen.getByText('Gerar versão').closest('li')!
  expect(within(answered).getByText('Gil Prado')).toBeTruthy()
  expect(within(answered).getByText('o agente está trabalhando')).toBeTruthy()

  const image = await screen.findByRole('img', { name: 'Versão 1' })
  const card = image.closest('li')!
  expect(image.getAttribute('src')).toMatch(/token=/)
  expect(within(card).getByText('Promoção de Natal')).toBeTruthy()
  const toggle = within(card).getByRole('button', { name: 'Ver prompt' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(within(card).queryByText('um pinheiro dourado')).toBeNull()
  await user.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(within(card).getByText('um pinheiro dourado')).toBeTruthy()
})

it('shows an agent error in its own card', async () => {
  const f = await createPieceFixture()
  const { data: msg } = await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Gerar' })
  const admin = serviceClient()
  await admin.from('session_events').update({ delivery: 'claimed', claimed_by: TEST_EXECUTOR, claimed_at: new Date().toISOString() }).eq('id', msg.id)
  const { error } = await admin.rpc('add_agent_event', {
    p_source_event: msg.id, p_executor: TEST_EXECUTOR, p_kind: 'agent_error',
    p_body: { message_ids: [msg.id], round: 1, code: 'timeout', message: 'O provedor demorou demais.', image_prompt: null },
  })
  expect(error).toBeNull()

  render(<Chat client={f.t.members.espectador.client}
    piece={(await loadPieces(f.t.members.espectador.client, f.campaignId))[0]!} role="espectador" members={[]} />)
  const card = (await screen.findByText('O provedor demorou demais.')).closest('li')!
  expect(card.className).toContain('agent-error')
  // No prompt was sent, so there is nothing to show.
  expect(within(card).queryByRole('button', { name: 'Ver prompt' })).toBeNull()
  // A person who is no longer in the list is "Alguém".
  expect(screen.getByText('Alguém')).toBeTruthy()
})

it('a gap fill never overwrites a newer live update', async () => {
  const f = await createPieceFixture()
  const { data: msg } = await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Gerar' })
  await serviceClient().from('session_events')
    .update({ delivery: 'claimed', claimed_by: TEST_EXECUTOR, claimed_at: new Date().toISOString() }).eq('id', msg.id)
  const client = f.t.members.designer.client

  render(<Chat client={client} piece={(await loadPieces(client, f.campaignId))[0]!} role="designer" members={[]} />)
  const message = (await screen.findByText('Gerar')).closest('li')!
  expect(within(message).getByText('o agente está trabalhando')).toBeTruthy()

  // The rejoin fill reads the claimed row, but its answer arrives late.
  const stale = await vi.mocked(loadEvents).getMockImplementation()!(client, f.pieceId, 0)
  let resolveFill!: (events: SessionEvent[]) => void
  vi.mocked(loadEvents).mockImplementationOnce(() => new Promise((resolve) => { resolveFill = resolve }))
  act(() => live.handlers!.onSubscribed())
  // Meanwhile the channel delivers the newer copy: the agent finished.
  const claimed = stale.find((e) => e.id === msg.id)!
  act(() => live.handlers!.onEvent({ ...claimed, delivery: 'done' }))
  expect(within(message).queryByText('o agente está trabalhando')).toBeNull()

  await act(async () => resolveFill(stale))
  expect(within(message).queryByText('o agente está trabalhando')).toBeNull()
})

it.each(['events arrive first', 'versions arrive first'])('a rejoin reloads the versions it missed when %s', async (order) => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const client = f.t.members.designer.client
  vi.mocked(loadEvents).mockClear()
  vi.mocked(loadVersions).mockClear()
  render(<Chat client={client}
    piece={(await loadPieces(client, f.campaignId))[0]!} role="designer" members={[]} />)
  // The mount's version list is read before the version exists.
  await act(async () => {
    await Promise.all([vi.mocked(loadVersions).mock.results[0]!.value,
      ...vi.mocked(loadEvents).mock.results.map((result) => result.value)])
  })

  // Created while the app is offline: no onVersion arrives.
  const version = await createAgentVersion(f, { caption: 'Promoção de Natal' })
  const { data: source } = await serviceClient().from('session_events').select('id')
    .eq('piece_id', f.pieceId).eq('kind', 'user_message').single()
  const { error } = await serviceClient().rpc('add_agent_event', {
    p_source_event: source!.id, p_executor: TEST_EXECUTOR, p_kind: 'agent_result',
    p_body: { message_ids: [source!.id], round: 1, version_id: version.id, version_number: 1, image_prompt: null },
  })
  expect(error).toBeNull()

  const missedEvents = await vi.mocked(loadEvents).getMockImplementation()!(client, f.pieceId)
  const missedVersions = await vi.mocked(loadVersions).getMockImplementation()!(client, f.pieceId)
  let resolveEvents!: (events: SessionEvent[]) => void
  let resolveVersions!: (versions: Version[]) => void
  vi.mocked(loadEvents).mockImplementationOnce(() => new Promise((resolve) => { resolveEvents = resolve }))
  vi.mocked(loadVersions).mockImplementationOnce(() => new Promise((resolve) => { resolveVersions = resolve }))
  act(() => live.handlers!.onSubscribed())
  if (order === 'events arrive first') {
    await act(async () => resolveEvents(missedEvents))
    expect(screen.getByText('Versão 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abrir versão 1' })).toBeNull()
    await act(async () => resolveVersions(missedVersions))
  } else {
    await act(async () => resolveVersions(missedVersions))
    expect(screen.queryByText('Versão 1')).toBeNull()
    await act(async () => resolveEvents(missedEvents))
  }
  const image = await screen.findByRole('img', { name: 'Versão 1' })
  const card = image.closest('li')!
  expect(image.getAttribute('src')).toMatch(/token=/)
  expect(within(card).getByText('Promoção de Natal')).toBeTruthy()
  await user.click(within(card).getByRole('button', { name: 'Abrir versão 1' }))
  const dialog = screen.getByRole('dialog', { name: 'Peça de teste — Versão 1' })
  expect(within(dialog).getByLabelText('Legenda da versão')).toHaveProperty('value', 'Promoção de Natal')
})

it('a failed gap fill is retried until it succeeds', async () => {
  const f = await createPieceFixture()
  vi.mocked(loadEvents).mockClear()
  render(<Chat client={f.t.members.designer.client}
    piece={(await loadPieces(f.t.members.designer.client, f.campaignId))[0]!} role="designer" members={[]} />)
  await act(() => vi.mocked(loadEvents).mock.results[0]!.value)
  // Posted while the app is away: only a fill can bring it in.
  await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Chegou depois' })

  // Only the retry delay is faked; Testing Library's polling is not used while it is.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    vi.mocked(loadEvents).mockClear().mockRejectedValueOnce(new Error('offline'))
    act(() => live.handlers!.onSubscribed())
    await act(async () => {})
    expect(screen.getByRole('alert')).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(vi.mocked(loadEvents)).toHaveBeenCalledTimes(2)
    await act(() => vi.mocked(loadEvents).mock.results[1]!.value)
    expect(screen.getByText('Chegou depois')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

it('an image that loads keeps the chat at the bottom', async () => {
  const f = await createPieceFixture()
  const version = await createAgentVersion(f)
  const { data: source } = await serviceClient().from('session_events').select('id')
    .eq('piece_id', f.pieceId).eq('kind', 'user_message').single()
  const { error } = await serviceClient().rpc('add_agent_event', {
    p_source_event: source!.id, p_executor: TEST_EXECUTOR, p_kind: 'agent_result',
    p_body: { message_ids: [source!.id], round: 1, version_id: version.id, version_number: 1, image_prompt: null },
  })
  expect(error).toBeNull()
  const { container } = render(<Chat client={f.t.members.designer.client}
    piece={(await loadPieces(f.t.members.designer.client, f.campaignId))[0]!} role="designer" members={[]} />)
  const image = await screen.findByRole('img', { name: 'Versão 1' })

  // jsdom has no layout: give the list a size it can scroll in.
  const chat = container.querySelector<HTMLElement>('.chat')!
  let height = 1000
  Object.defineProperty(chat, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(chat, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(chat, 'scrollTop', { configurable: true, writable: true, value: 600 })

  // At the end, the image grows the content and the list follows it.
  height = 1500
  fireEvent.load(image)
  expect(chat.scrollTop).toBe(1500)

  // Someone reading older messages is left where they are.
  chat.scrollTop = 100
  fireEvent.scroll(chat)
  height = 2000
  fireEvent.load(image)
  expect(chat.scrollTop).toBe(100)
})

it('loads comments in the viewer, saves without Realtime and fills remote changes after reconnect', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const version = await createAgentVersion(f)
  const client = f.t.members.designer.client
  const input = { teamId: f.t.teamId, pieceId: f.pieceId, versionId: version.id, target: null, parentId: null }
  const root = await addComment(client, { ...input, body: 'Conferir o logo' })
  render(<Chat client={client} piece={(await loadPieces(client, f.campaignId))[0]!} role="designer" members={[]} />)
  await user.click(await screen.findByRole('button', { name: 'Abrir versão 1' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('Conferir o logo')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Responder' }))
  await user.type(within(dialog).getByLabelText('Comentário'), 'Já ajustei')
  await user.click(within(dialog).getByRole('button', { name: 'Enviar comentário' }))
  expect(await within(dialog).findByText('Já ajustei')).toBeTruthy()
  expect((await loadComments(client, f.pieceId)).map((c) => c.body)).toEqual(['Conferir o logo', 'Já ajustei'])

  await setResolved(f.t.members.gestor.client, root.id, true)
  await act(async () => live.handlers!.onComment())
  expect(await within(dialog).findByRole('button', { name: 'Reabrir' })).toBeTruthy()
  await addComment(f.t.members.gestor.client, { ...input, body: 'Recebido durante a queda', parentId: root.id })
  await act(async () => live.handlers!.onSubscribed())
  expect(await within(dialog).findByText('Recebido durante a queda')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Reabrir' }))
  expect(await within(dialog).findByRole('button', { name: 'Resolver' })).toBeTruthy()
  expect((await loadComments(client, f.pieceId))[0]?.resolved).toBe(false)
})
