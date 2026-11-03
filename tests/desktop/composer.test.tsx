// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Piece } from '../../packages/desktop/src/data/campaigns.ts'
import type { PostInput } from '../../packages/desktop/src/data/events.ts'
import type { Reference } from '../../packages/desktop/src/data/references.ts'
import { Composer } from '../../packages/desktop/src/ui/Composer.tsx'

const piece: Piece = { id: 'piece', campaign_id: 'campaign', team_id: 'team', title: 'Banner', kind: 'imagem_texto',
  status: 'gerando', approved_version_id: null, created_at: '2026-11-02T12:00:00Z' }
const members = [{ userId: 'ana', name: 'Ana Souza' }, { userId: 'bia', name: 'Bia' }]
const references: Reference[] = [{ id: 'reference', campaign_id: 'campaign', team_id: 'team',
  storage_path: 'team/product.png', original_name: 'Produto.png', created_at: piece.created_at }]
const defaults = { piece, members, keyed: ['openai', 'gemini', 'fal'] as const, choices: [], references, urls: {} }

function props() { return { ...defaults, keyed: [...defaults.keyed] } }

it('sends the picked model and references to the agent', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} onPost={async (input) => { posted.push(input) }} />)
  expect(screen.getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true)
  await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'Crie um banner')
  expect(screen.getByText('Para o agente')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Esforço de texto'), 'high')
  await user.selectOptions(screen.getByLabelText('Modelo de imagem'), 'Flux Kontext Max')
  await user.click(screen.getByRole('button', { name: 'Anexar referência' }))
  await user.click(screen.getByRole('checkbox', { name: 'Produto.png' }))
  await user.click(screen.getByRole('button', { name: 'Usar selecionadas' }))
  expect(screen.getByRole('button', { name: 'Remover Produto.png' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(posted).toEqual([{ pieceId: 'piece', text: 'Crie um banner', mentionUserIds: [],
    model: { text: { provider: 'openai', model: 'gpt-6-astra', effort: 'high' },
      image: { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max/multi' } }, referenceAssetIds: ['reference'] }])
  expect(screen.getByRole('textbox')).toHaveProperty('value', '')
  expect(screen.queryByRole('button', { name: 'Remover Produto.png' })).toBeNull()
})

it('a message to a person carries no model', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} keyed={[]} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), '@Ana')
  await user.click(screen.getByRole('button', { name: 'Ana Souza' }))
  expect(screen.getByRole('textbox')).toHaveProperty('value', '@Ana Souza ')
  await user.type(screen.getByRole('textbox'), 'oi')
  expect(screen.getByText('Para @Ana Souza')).toBeTruthy()
  expect(screen.queryByLabelText('Modelo de texto')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(posted).toEqual([{ pieceId: 'piece', text: '@Ana Souza oi', mentionUserIds: ['ana'], model: null, referenceAssetIds: [] }])
})

it.each(['\u001c', '\u001d', '\u001e', '\u001f', '\u0085'])('sends a person message after SQL whitespace %j without a text key', async (space) => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} keyed={[]} onPost={async (input) => { posted.push(input) }} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: `${space}@Ana Souza oi` } })
  expect(screen.getByText('Para @Ana Souza')).toBeTruthy()
  expect(screen.queryByLabelText('Modelo de texto')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(posted).toEqual([{ pieceId: 'piece', text: `${space}@Ana Souza oi`,
    mentionUserIds: ['ana'], model: null, referenceAssetIds: [] }])
})

it('effort select appears only for models with efforts', async () => {
  const user = userEvent.setup()
  render(<Composer {...props()} onPost={async () => {}} />)
  expect(screen.getByLabelText('Esforço de imagem')).toHaveProperty('value', '')
  await user.selectOptions(screen.getByLabelText('Esforço de imagem'), 'high')
  await user.selectOptions(screen.getByLabelText('Modelo de imagem'), 'Flux Kontext Max')
  expect(screen.queryByLabelText('Esforço de imagem')).toBeNull()
  await user.selectOptions(screen.getByLabelText('Modelo de imagem'), 'Nano Banana 2.1')
  expect(screen.getByLabelText('Esforço de imagem')).toHaveProperty('value', '')
})

it('blocks agent messages when no text key', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} keyed={['gemini']} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox'), 'Gere um banner{Enter}')
  expect(screen.getByText('Nenhuma chave de texto cadastrada. Peça ao admin do time.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true)
  expect(posted).toEqual([])
})

it('Enter sends, Shift+Enter adds a line, and IME Enter does not send', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} onPost={async (input) => { posted.push(input) }} />)
  const input = screen.getByRole('textbox')
  await user.type(input, 'Linha 1{Shift>}{Enter}{/Shift}Linha 2')
  expect(input).toHaveProperty('value', 'Linha 1\nLinha 2')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(posted).toEqual([])
  await user.keyboard('{Enter}')
  expect(posted[0]?.text).toBe('Linha 1\nLinha 2')
})

it('keeps the draft and references after a failure and prevents duplicate submissions', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  let reject!: (reason: Error) => void
  let attempts = 0
  render(<Composer {...props()} onPost={async (input) => {
    attempts++
    if (attempts === 1) await new Promise<void>((_resolve, no) => { reject = no })
    posted.push(input)
  }} />)
  await user.type(screen.getByRole('textbox'), 'Pedido')
  await user.click(screen.getByRole('button', { name: 'Anexar referência' }))
  await user.click(screen.getByRole('checkbox', { name: 'Produto.png' }))
  await user.click(screen.getByRole('button', { name: 'Usar selecionadas' }))
  const send = screen.getByRole('button', { name: 'Enviar' })
  await user.dblClick(send)
  expect(attempts).toBe(1)
  reject(new Error('Failed to fetch'))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sem conexão com o servidor. Tente de novo.')
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Pedido')
  expect(screen.getByRole('button', { name: 'Remover Produto.png' })).toBeTruthy()
  await user.click(send)
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]?.referenceAssetIds).toEqual(['reference'])
  expect(screen.queryByRole('alert')).toBeNull()
})

it('supports keyboard mention selection and removes deleted mentions from the payload', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox'), '@{ArrowDown}{Enter}')
  expect(screen.getByRole('textbox')).toHaveProperty('value', '@Bia ')
  expect(posted).toEqual([])
  await user.clear(screen.getByRole('textbox'))
  await user.type(screen.getByRole('textbox'), 'Oi @Ana Souza{Escape}{Enter}')
  expect(posted[0]?.mentionUserIds).toEqual(['ana'])
  expect(posted[0]?.model?.text).toEqual({ provider: 'openai', model: 'gpt-6-astra' })
})

it('inherits loaded choices and falls back when a selected provider loses its key', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  const { rerender } = render(<Composer {...props()} keyed={['openai', 'anthropic']} onPost={async (input) => { posted.push(input) }} />)
  rerender(<Composer {...props()} keyed={['openai', 'anthropic']}
    choices={[{ text: { provider: 'openai', model: 'gpt-6-astra', effort: 'medium' } }]}
    onPost={async (input) => { posted.push(input) }} />)
  expect(screen.getByLabelText('Modelo de texto')).toHaveProperty('value', 'gpt-6-astra')
  expect(screen.getByLabelText('Esforço de texto')).toHaveProperty('value', 'medium')
  await user.selectOptions(screen.getByLabelText('Esforço de texto'), 'high')
  rerender(<Composer {...props()} keyed={['anthropic']} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox'), 'Olá{Enter}')
  expect(posted[0]?.model).toEqual({ text: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })
})
