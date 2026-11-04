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
  expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Crie um banner')
  expect(screen.getByText('To the agent')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Text effort'), 'high')
  await user.selectOptions(screen.getByLabelText('Image model'), 'Flux Kontext Max')
  await user.click(screen.getByRole('button', { name: 'Attach reference' }))
  await user.click(screen.getByRole('checkbox', { name: 'Produto.png' }))
  await user.click(screen.getByRole('button', { name: 'Use selected' }))
  expect(screen.getByRole('button', { name: 'Remove Produto.png' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(posted).toEqual([{ pieceId: 'piece', text: 'Crie um banner', mentionUserIds: [],
    model: { text: { provider: 'openai', model: 'gpt-6-astra', effort: 'high' },
      image: { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max/multi' } }, referenceAssetIds: ['reference'] }])
  expect(screen.getByRole('textbox')).toHaveProperty('value', '')
  expect(screen.queryByRole('button', { name: 'Remove Produto.png' })).toBeNull()
})

it('a message to a person carries no model', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} keyed={[]} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox', { name: 'Message' }), '@Ana')
  await user.click(screen.getByRole('button', { name: 'Ana Souza' }))
  expect(screen.getByRole('textbox')).toHaveProperty('value', '@Ana Souza ')
  await user.type(screen.getByRole('textbox'), 'oi')
  expect(screen.getByText('To @Ana Souza')).toBeTruthy()
  expect(screen.queryByLabelText('Text model')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(posted).toEqual([{ pieceId: 'piece', text: '@Ana Souza oi', mentionUserIds: ['ana'], model: null, referenceAssetIds: [] }])
})

it.each(['\u001c', '\u001d', '\u001e', '\u001f', '\u0085'])('sends a person message after SQL whitespace %j without a text key', async (space) => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} keyed={[]} onPost={async (input) => { posted.push(input) }} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: `${space}@Ana Souza oi` } })
  expect(screen.getByText('To @Ana Souza')).toBeTruthy()
  expect(screen.queryByLabelText('Text model')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(posted).toEqual([{ pieceId: 'piece', text: `${space}@Ana Souza oi`,
    mentionUserIds: ['ana'], model: null, referenceAssetIds: [] }])
})

it('effort select appears only for models with efforts', async () => {
  const user = userEvent.setup()
  render(<Composer {...props()} onPost={async () => {}} />)
  expect(screen.getByLabelText('Image effort')).toHaveProperty('value', '')
  await user.selectOptions(screen.getByLabelText('Image effort'), 'high')
  await user.selectOptions(screen.getByLabelText('Image model'), 'Flux Kontext Max')
  expect(screen.queryByLabelText('Image effort')).toBeNull()
  await user.selectOptions(screen.getByLabelText('Image model'), 'Nano Banana 2.1')
  expect(screen.getByLabelText('Image effort')).toHaveProperty('value', '')
})

it('blocks agent messages when no text key', async () => {
  const user = userEvent.setup()
  const posted: PostInput[] = []
  render(<Composer {...props()} keyed={['gemini']} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox'), 'Gere um banner{Enter}')
  expect(screen.getByText('No text provider key added. Ask your workspace admin.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
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
  await user.click(screen.getByRole('button', { name: 'Attach reference' }))
  await user.click(screen.getByRole('checkbox', { name: 'Produto.png' }))
  await user.click(screen.getByRole('button', { name: 'Use selected' }))
  const send = screen.getByRole('button', { name: 'Send' })
  await user.dblClick(send)
  expect(attempts).toBe(1)
  reject(new Error('Failed to fetch'))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Cannot connect to the server. Try again.')
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Pedido')
  expect(screen.getByRole('button', { name: 'Remove Produto.png' })).toBeTruthy()
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
  expect(screen.getByLabelText('Text model')).toHaveProperty('value', 'gpt-6-astra')
  expect(screen.getByLabelText('Text effort')).toHaveProperty('value', 'medium')
  await user.selectOptions(screen.getByLabelText('Text effort'), 'high')
  rerender(<Composer {...props()} keyed={['anthropic']} onPost={async (input) => { posted.push(input) }} />)
  await user.type(screen.getByRole('textbox'), 'Olá{Enter}')
  expect(posted[0]?.model).toEqual({ text: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })
})
