import { loadConfig } from '../../packages/executor/src/config.ts'

const BASE = { SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_SERVICE_ROLE_KEY: 'x' }

it('applies defaults', () => {
  const c = loadConfig(BASE)
  expect(c).toMatchObject({
    supabaseUrl: 'http://127.0.0.1:55321', serviceRoleKey: 'x',
    concurrency: 4, pollIntervalMs: 1000, touchIntervalMs: 30000, staleAfterSeconds: 300,
    sweepIntervalMs: 60000, textTimeoutMs: 240000, imageTimeoutMs: 300000, shutdownGraceMs: 120000,
  })
  expect(c.executorId).toMatch(new RegExp(`-${process.pid}$`))
})

it('reads overrides from the environment', () => {
  const c = loadConfig({ ...BASE, EXECUTOR_ID: 'exec-1', EXECUTOR_CONCURRENCY: '8', SHUTDOWN_GRACE_MS: '0' })
  expect(c).toMatchObject({ executorId: 'exec-1', concurrency: 8, shutdownGraceMs: 0 })
})

it('names missing variables without echoing values', () => {
  expect(() => loadConfig({ SUPABASE_SERVICE_ROLE_KEY: 'secret-value' })).toThrow(/SUPABASE_URL/)
  try { loadConfig({ SUPABASE_SERVICE_ROLE_KEY: 'secret-value' }) } catch (e) { expect(String(e)).not.toContain('secret-value') }
  expect(() => loadConfig({ SUPABASE_URL: 'http://x' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
})

it('rejects invalid numbers without echoing values', () => {
  const bad = { ...BASE, EXECUTOR_CONCURRENCY: '33', POLL_INTERVAL_MS: 'abc-secret', SWEEP_INTERVAL_MS: '1.5' }
  expect(() => loadConfig(bad)).toThrow(/EXECUTOR_CONCURRENCY.*POLL_INTERVAL_MS.*SWEEP_INTERVAL_MS/)
  try { loadConfig(bad) } catch (e) { expect(String(e)).not.toContain('abc-secret') }
})

it('caps provider timeouts at the 300 s fetch header limit without echoing values', () => {
  const bad = { ...BASE, TEXT_TIMEOUT_MS: '300001', IMAGE_TIMEOUT_MS: '300001' }
  expect(() => loadConfig(bad)).toThrow(/TEXT_TIMEOUT_MS.*IMAGE_TIMEOUT_MS/)
  try { loadConfig(bad) } catch (e) { expect(String(e)).not.toContain('300001') }
  expect(loadConfig({ ...BASE, TEXT_TIMEOUT_MS: '300000', IMAGE_TIMEOUT_MS: '300000' }))
    .toMatchObject({ textTimeoutMs: 300000, imageTimeoutMs: 300000 })
})

it('rejects touch interval too close to stale threshold', () => {
  expect(() => loadConfig({ ...BASE, TOUCH_INTERVAL_MS: '200000' })).toThrow(/TOUCH_INTERVAL_MS/)
  expect(loadConfig({ ...BASE, TOUCH_INTERVAL_MS: '100000' }).touchIntervalMs).toBe(100000)
})
