// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { LoginScreen } from '../../packages/desktop/src/ui/LoginScreen.tsx'

type Props = ComponentProps<typeof LoginScreen>

/** Renders the login screen with props that record each call. */
function renderLogin(overrides: Partial<Props> = {}) {
  const calls = { sent: [] as string[], verified: [] as [string, string][], oauth: [] as string[] }
  render(
    <LoginScreen
      sendCode={async (email) => { calls.sent.push(email) }}
      verifyCode={async (email, code) => { calls.verified.push([email, code]) }}
      startOAuth={async (provider) => { calls.oauth.push(provider) }}
      {...overrides}
    />,
  )
  return calls
}

it('asks for the code after sending it', async () => {
  const user = userEvent.setup()
  const calls = renderLogin()
  expect(screen.getByText('ou entre com um código no e-mail')).toBeTruthy()

  await user.type(screen.getByLabelText('E-mail'), 'ana@test.local')
  await user.click(screen.getByRole('button', { name: 'Enviar código' }))
  expect(calls.sent).toEqual(['ana@test.local'])
  expect(await screen.findByText('Enviamos um código de 6 dígitos para ana@test.local.')).toBeTruthy()

  await user.type(screen.getByLabelText('Código'), '123456')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  expect(calls.verified).toEqual([['ana@test.local', '123456']])

  await user.click(screen.getByRole('button', { name: 'Usar outro e-mail' }))
  expect(screen.getByRole('button', { name: 'Enviar código' })).toBeTruthy()
})

it('shows the friendly error and keeps the email', async () => {
  const user = userEvent.setup()
  renderLogin({ sendCode: async () => { throw new TypeError('fetch failed') } })

  await user.type(screen.getByLabelText('E-mail'), 'ana@test.local')
  await user.click(screen.getByRole('button', { name: 'Enviar código' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Sem conexão com o servidor. Tente de novo.')
  expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@test.local')
})

it('shows the friendly error of a refused code and stays on the code step', async () => {
  const user = userEvent.setup()
  renderLogin({ verifyCode: async () => { throw new Error('Token has expired or is invalid') } })

  await user.type(screen.getByLabelText('E-mail'), 'ana@test.local')
  await user.click(screen.getByRole('button', { name: 'Enviar código' }))
  await user.type(await screen.findByLabelText('Código'), '000000')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Algo deu errado. Tente de novo.')
  expect(screen.getByText('Enviamos um código de 6 dígitos para ana@test.local.')).toBeTruthy()
})

it('starts Google and Apple sign-in', async () => {
  const user = userEvent.setup()
  const calls = renderLogin()

  await user.click(screen.getByRole('button', { name: 'Entrar com Google' }))
  expect(calls.oauth).toEqual(['google'])
  expect(await screen.findByText('Continue no navegador…')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Entrar com Apple' }))
  expect(calls.oauth).toEqual(['google', 'apple'])
})

it('shows the friendly error when a sign-in provider cannot start', async () => {
  const user = userEvent.setup()
  renderLogin({ startOAuth: async () => { throw new Error('Unsupported provider: provider is not enabled') } })

  await user.click(screen.getByRole('button', { name: 'Entrar com Google' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Esse jeito de entrar ainda não está disponível.')
  expect(screen.queryByText('Continue no navegador…')).toBeNull()
})

it('shows a sign-in error that came back from the browser', () => {
  renderLogin({ error: 'Não foi possível entrar. Tente de novo.' })
  expect(screen.getByRole('alert').textContent).toBe('Não foi possível entrar. Tente de novo.')
})
