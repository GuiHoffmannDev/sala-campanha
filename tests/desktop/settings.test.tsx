// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Settings } from '../../packages/desktop/src/ui/Settings.tsx'
import type { KeyRow } from '../../packages/desktop/src/data/keys.ts'

const nothing = async () => {}
const defaults = { teamId: 'team', keys: [], members: [
  { userId: 'me', displayName: 'Ana', role: 'admin' as const },
  { userId: 'other', displayName: 'Bia', role: 'designer' as const },
], invites: [], me: 'me', onSaveKey: nothing, onDeleteKey: nothing, onInvite: nothing,
  onRevokeInvite: nothing, onSetRole: nothing, onRemove: nothing }

afterEach(() => vi.restoreAllMocks())

it('clears the typed key after saving and shows only the mask', async () => {
  const user = userEvent.setup()
  function Host() {
    const [keys, setKeys] = useState<KeyRow[]>([])
    return <Settings {...defaults} keys={keys} onSaveKey={async (provider, key) => {
      setKeys([{ provider, last4: key.slice(-4), updated_at: '2026-11-03T12:00:00Z' }])
    }} />
  }
  render(<Host />)
  const field = screen.getByLabelText('Chave Anthropic') as HTMLInputElement
  expect(field.type).toBe('password')
  expect(field.autocomplete).toBe('off')
  await user.type(field, 'chave-falsa-local-1234')
  await user.click(within(screen.getByRole('region', { name: 'Anthropic' })).getByRole('button', { name: 'Salvar' }))
  expect(field.value).toBe('')
  expect(await screen.findByText('...1234')).toBeTruthy()
  expect(screen.queryByText('chave-falsa-local-1234')).toBeNull()
  expect(screen.getByText(/Atualizada em/)).toBeTruthy()
})

it('asks before removing a member', async () => {
  const user = userEvent.setup()
  const removed: string[] = []
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<Settings {...defaults} onRemove={async (id) => { removed.push(id) }} />)
  await user.click(screen.getByRole('tab', { name: 'Membros' }))
  const member = screen.getByRole('group', { name: 'Bia' })
  await user.click(within(member).getByRole('button', { name: 'Remover' }))
  expect(confirm.mock.calls[0]?.[0]).toMatch(/perde o acesso na hora/)
  expect(removed).toEqual([])
  confirm.mockReturnValue(true)
  await user.click(within(member).getByRole('button', { name: 'Remover' }))
  expect(removed).toEqual(['other'])
})

it('shows the text to send after inviting', async () => {
  const user = userEvent.setup()
  const invited: unknown[] = []
  render(<Settings {...defaults} onInvite={async (email, role) => { invited.push([email, role]) }} />)
  await user.click(screen.getByRole('tab', { name: 'Membros' }))
  await user.type(screen.getByLabelText('E-mail'), 'nova@example.com')
  await user.selectOptions(screen.getByLabelText('Papel do convite'), 'gestor')
  await user.click(screen.getByRole('button', { name: 'Convidar' }))
  expect(invited).toEqual([['nova@example.com', 'gestor']])
  expect(await screen.findByText('Convite criado. Avise a pessoa: baixe a Sala da Campanha e entre com nova@example.com.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()
})

it('keeps the key field empty and shows a friendly error when saving fails', async () => {
  const user = userEvent.setup()
  render(<Settings {...defaults} onSaveKey={async () => { throw new Error('only team admins can set provider keys') }} />)
  const field = screen.getByLabelText('Chave Anthropic') as HTMLInputElement
  await user.type(field, 'chave-falsa-local-1234')
  await user.click(within(screen.getByRole('region', { name: 'Anthropic' })).getByRole('button', { name: 'Salvar' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Só o admin do workspace gerencia as chaves.')
  expect(field.value).toBe('')
})

it('confirms key deletion, changes roles and cancels pending invites', async () => {
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const changes: unknown[] = []
  render(<Settings {...defaults} keys={[{ provider: 'openai', last4: '0001', updated_at: '2026-11-03T12:00:00Z' }]}
    invites={[{ email: 'nova@example.com', role: 'designer', created_at: '2026-11-03T12:00:00Z' }]}
    onDeleteKey={async (provider) => { changes.push(provider) }}
    onSetRole={async (id, role) => { changes.push([id, role]) }}
    onRevokeInvite={async (email) => { changes.push(email) }} />)
  await user.click(within(screen.getByRole('region', { name: 'OpenAI' })).getByRole('button', { name: 'Remover' }))
  await user.click(screen.getByRole('tab', { name: 'Membros' }))
  await user.selectOptions(screen.getByLabelText('Papel de Bia'), 'gestor')
  await user.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(changes).toEqual(['openai', ['other', 'gestor'], 'nova@example.com'])
})
