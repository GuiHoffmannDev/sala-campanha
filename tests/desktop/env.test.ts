import { readEnv } from '../../packages/desktop/src/env.ts'

it('reads the Supabase URL and anon key', () => {
  expect(readEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:55321', VITE_SUPABASE_ANON_KEY: 'anon' }))
    .toEqual({ supabaseUrl: 'http://127.0.0.1:55321', anonKey: 'anon' })
})

it('names both variables when one is missing', () => {
  expect(() => readEnv({ VITE_SUPABASE_URL: 'x' })).toThrow(/Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY/)
})
