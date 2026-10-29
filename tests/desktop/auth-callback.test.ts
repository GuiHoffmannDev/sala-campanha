import { parseAuthCallback } from '../../packages/desktop/src/lib/link.ts'

it('reads the code from the auth callback', () => {
  expect(parseAuthCallback('sala://auth/callback?code=abc-123')).toEqual({ code: 'abc-123' })
  expect(parseAuthCallback('sala://auth/callback/?code=abc-123')).toEqual({ code: 'abc-123' })
})

it('reads the error description', () => {
  expect(parseAuthCallback('sala://auth/callback?error=access_denied&error_description=User+cancelled'))
    .toEqual({ error: 'User cancelled' })
  expect(parseAuthCallback('sala://auth/callback?error=access_denied')).toEqual({ error: 'access_denied' })
  // Supabase puts some errors in the fragment instead of the query.
  expect(parseAuthCallback('sala://auth/callback#error=server_error&error_description=Bad%20state'))
    .toEqual({ error: 'Bad state' })
})

it('ignores other links and other schemes', () => {
  for (const url of [
    'sala://campanha/7f1c2a4e-1b2c-4d3e-8f90-123456789abc',
    'sala://auth/other?code=abc',
    'sala://auth/callbacks?code=abc',
    'sala://auth/callback',
    'https://auth/callback?code=abc',
    'salas://auth/callback?code=abc',
    'not a link',
  ]) {
    expect(parseAuthCallback(url), url).toBeNull()
  }
})
