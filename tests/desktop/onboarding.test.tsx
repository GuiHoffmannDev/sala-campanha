// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Onboarding } from '../../packages/desktop/src/ui/Onboarding.tsx'

const nothing = async () => {}

it('saves the suggested name', async () => {
  const user = userEvent.setup()
  const saved: string[] = []
  render(<Onboarding step="name" suggestedName="Ana Souza" onSaveName={async (n) => { saved.push(n) }} onCreateWorkspace={nothing} />)

  expect(screen.getByText('How should your name appear to the team?')).toBeTruthy()
  expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Ana Souza')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(saved).toEqual(['Ana Souza'])
})

it('does not continue with a blank name', async () => {
  const user = userEvent.setup()
  const saved: string[] = []
  render(<Onboarding step="name" suggestedName="" onSaveName={async (n) => { saved.push(n) }} onCreateWorkspace={nothing} />)

  await user.type(screen.getByLabelText('Your name'), '   ')
  expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  await user.keyboard('{Enter}')
  expect(saved).toEqual([])
})

it('creates the workspace with the typed name', async () => {
  const user = userEvent.setup()
  const created: string[] = []
  render(<Onboarding step="workspace" suggestedName="Ana Souza" onSaveName={nothing} onCreateWorkspace={async (n) => { created.push(n) }} />)

  expect(screen.getByText('Create your workspace')).toBeTruthy()
  const field = screen.getByLabelText('Workspace name') as HTMLInputElement
  expect(field.value).toBe('Workspace for Ana')
  await user.clear(field)
  await user.type(field, '  Equipe Azul ')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(created).toEqual(['Equipe Azul'])
})

it('shows the friendly error when creating the workspace fails', async () => {
  const user = userEvent.setup()
  render(
    <Onboarding step="workspace" suggestedName="Ana" onSaveName={nothing}
      onCreateWorkspace={async () => { throw new Error('workspace name must not be empty') }} />,
  )

  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Give your workspace a name.')
  expect(screen.getByText('Create your workspace')).toBeTruthy()
})
