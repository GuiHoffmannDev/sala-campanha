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
  expect(screen.getByText('or sign in with an email code')).toBeTruthy()

  await user.type(screen.getByLabelText('Email'), 'ana@test.local')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  expect(calls.sent).toEqual(['ana@test.local'])
  expect(await screen.findByText('We sent a 6-digit code to ana@test.local.')).toBeTruthy()

  await user.type(screen.getByLabelText('Code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(calls.verified).toEqual([['ana@test.local', '123456']])

  await user.click(screen.getByRole('button', { name: 'Use another email' }))
  expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
})

it('shows the friendly error and keeps the email', async () => {
  const user = userEvent.setup()
  renderLogin({ sendCode: async () => { throw new TypeError('fetch failed') } })

  await user.type(screen.getByLabelText('Email'), 'ana@test.local')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Cannot connect to the server. Try again.')
  expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ana@test.local')
})

it('shows the friendly error of a refused code and stays on the code step', async () => {
  const user = userEvent.setup()
  renderLogin({ verifyCode: async () => { throw new Error('Token has expired or is invalid') } })

  await user.type(screen.getByLabelText('Email'), 'ana@test.local')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  await user.type(await screen.findByLabelText('Code'), '000000')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.')
  expect(screen.getByText('We sent a 6-digit code to ana@test.local.')).toBeTruthy()
})

it('starts Google and Apple sign-in', async () => {
  const user = userEvent.setup()
  const calls = renderLogin()

  await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
  expect(calls.oauth).toEqual(['google'])
  expect(await screen.findByText('Continue in your browser…')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Continue with Apple' }))
  expect(calls.oauth).toEqual(['google', 'apple'])
})

it('shows the friendly error when a sign-in provider cannot start', async () => {
  const user = userEvent.setup()
  renderLogin({ startOAuth: async () => { throw new Error('Unsupported provider: provider is not enabled') } })

  await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
  expect((await screen.findByRole('alert')).textContent).toBe('This sign-in method is not available yet.')
  expect(screen.queryByText('Continue in your browser…')).toBeNull()
})

it('shows a sign-in error that came back from the browser', () => {
  renderLogin({ error: 'Could not sign in. Try again.' })
  expect(screen.getByRole('alert').textContent).toBe('Could not sign in. Try again.')
})
