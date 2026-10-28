import os from 'node:os'
import { z } from 'zod'

export type Config = {
  supabaseUrl: string
  serviceRoleKey: string
  executorId: string
  concurrency: number
  pollIntervalMs: number
  touchIntervalMs: number
  staleAfterSeconds: number
  sweepIntervalMs: number
  textTimeoutMs: number
  imageTimeoutMs: number
  shutdownGraceMs: number
}

// Env values are strings: accept only plain decimal integers, then range-check.
const int = (fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.string().regex(/^\d+$/).default(String(fallback)).transform(Number).pipe(z.number().int().min(min).max(max))

// Node's fetch waits at most 300 s for response headers, so a non-streaming provider call cannot outlast it.
const MAX_CALL_MS = 300_000

const EnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EXECUTOR_ID: z.string().trim().min(1).optional(),
  EXECUTOR_CONCURRENCY: int(4, 1, 32),
  POLL_INTERVAL_MS: int(1000, 100),
  TOUCH_INTERVAL_MS: int(30000, 1000),
  STALE_AFTER_SECONDS: int(300, 1),
  SWEEP_INTERVAL_MS: int(60000, 1000),
  TEXT_TIMEOUT_MS: int(240000, 1000, MAX_CALL_MS),
  IMAGE_TIMEOUT_MS: int(300000, 1000, MAX_CALL_MS),
  SHUTDOWN_GRACE_MS: int(600000, 0),
}).check((ctx) => {
  // Cross-field rules need every field valid; otherwise they would name a variable that is fine.
  if (ctx.issues.length > 0) return
  // The claim must be touched at least three times before it counts as stale.
  if (ctx.value.TOUCH_INTERVAL_MS * 3 > ctx.value.STALE_AFTER_SECONDS * 1000) {
    ctx.issues.push({ code: 'custom', path: ['TOUCH_INTERVAL_MS'], message: 'too close to STALE_AFTER_SECONDS', input: ctx.value })
  }
  // A round in progress at shutdown must finish: one text call, one image call and 60 s for the database and Storage.
  if (ctx.value.SHUTDOWN_GRACE_MS < ctx.value.TEXT_TIMEOUT_MS + ctx.value.IMAGE_TIMEOUT_MS + 60_000) {
    ctx.issues.push({ code: 'custom', path: ['SHUTDOWN_GRACE_MS'], message: 'shorter than a round', input: ctx.value })
  }
})

/** Reads the executor settings. Errors name the invalid variables, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new Error(`Invalid executor configuration: ${names.join(', ')}`)
  }
  const e = parsed.data
  return {
    supabaseUrl: e.SUPABASE_URL,
    serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    executorId: e.EXECUTOR_ID ?? `${os.hostname()}-${process.pid}`,
    concurrency: e.EXECUTOR_CONCURRENCY,
    pollIntervalMs: e.POLL_INTERVAL_MS,
    touchIntervalMs: e.TOUCH_INTERVAL_MS,
    staleAfterSeconds: e.STALE_AFTER_SECONDS,
    sweepIntervalMs: e.SWEEP_INTERVAL_MS,
    textTimeoutMs: e.TEXT_TIMEOUT_MS,
    imageTimeoutMs: e.IMAGE_TIMEOUT_MS,
    shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
  }
}
