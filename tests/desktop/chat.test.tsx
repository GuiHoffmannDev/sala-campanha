// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from '../../packages/desktop/src/ui/Chat.tsx'
import { createAgentVersion, createPieceFixture, serviceClient, TEST_EXECUTOR } from '../helpers/supabase'

// Node's WebSocket rejects jsdom's events; the live channel is tested in events.test.ts.
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/events.ts')>()),
  subscribePiece: () => () => {},
}))

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
  render(<Chat client={f.t.members.designer.client} pieceId={f.pieceId} members={members} />)

  const latest = (await screen.findByText('Agora mais claro')).closest('li')!
  expect(within(latest).getByText('Gil Prado')).toBeTruthy()
  expect(within(latest).getByText('GP')).toBeTruthy()
  expect(within(latest).getByText('na fila')).toBeTruthy()
  // The message the agent took stays claimed until the executor closes it.
  const answered = screen.getByText('Gerar versão').closest('li')!
  expect(within(answered).getByText('Gil Prado')).toBeTruthy()
  expect(within(answered).getByText('o agente está trabalhando')).toBeTruthy()

  const card = (await screen.findByText('Versão 1')).closest('li')!
  const image = await within(card).findByRole('img', { name: 'Versão 1' })
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

  render(<Chat client={f.t.members.espectador.client} pieceId={f.pieceId} members={[]} />)
  const card = (await screen.findByText('O provedor demorou demais.')).closest('li')!
  expect(card.className).toContain('agent-error')
  // No prompt was sent, so there is nothing to show.
  expect(within(card).queryByRole('button', { name: 'Ver prompt' })).toBeNull()
  // A person who is no longer in the list is "Alguém".
  expect(screen.getByText('Alguém')).toBeTruthy()
})
