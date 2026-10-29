// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Onboarding } from '../../packages/desktop/src/ui/Onboarding.tsx'

const nothing = async () => {}

it('saves the suggested name', async () => {
  const user = userEvent.setup()
  const saved: string[] = []
  render(<Onboarding step="name" suggestedName="Ana Souza" onSaveName={async (n) => { saved.push(n) }} onCreateWorkspace={nothing} />)

  expect(screen.getByText('Como você quer aparecer para o time?')).toBeTruthy()
  expect((screen.getByLabelText('Seu nome') as HTMLInputElement).value).toBe('Ana Souza')
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(saved).toEqual(['Ana Souza'])
})

it('does not continue with a blank name', async () => {
  const user = userEvent.setup()
  const saved: string[] = []
  render(<Onboarding step="name" suggestedName="" onSaveName={async (n) => { saved.push(n) }} onCreateWorkspace={nothing} />)

  await user.type(screen.getByLabelText('Seu nome'), '   ')
  expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true)
  await user.keyboard('{Enter}')
  expect(saved).toEqual([])
})

it('creates the workspace with the typed name', async () => {
  const user = userEvent.setup()
  const created: string[] = []
  render(<Onboarding step="workspace" suggestedName="Ana Souza" onSaveName={nothing} onCreateWorkspace={async (n) => { created.push(n) }} />)

  expect(screen.getByText('Crie seu workspace')).toBeTruthy()
  const field = screen.getByLabelText('Nome do workspace') as HTMLInputElement
  expect(field.value).toBe('Workspace de Ana')
  await user.clear(field)
  await user.type(field, '  Equipe Azul ')
  await user.click(screen.getByRole('button', { name: 'Criar' }))
  expect(created).toEqual(['Equipe Azul'])
})

it('shows the friendly error when creating the workspace fails', async () => {
  const user = userEvent.setup()
  render(
    <Onboarding step="workspace" suggestedName="Ana" onSaveName={nothing}
      onCreateWorkspace={async () => { throw new Error('workspace name must not be empty') }} />,
  )

  await user.click(screen.getByRole('button', { name: 'Criar' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Dê um nome ao workspace.')
  expect(screen.getByText('Crie seu workspace')).toBeTruthy()
})
