import { createClient } from '@supabase/supabase-js'
import { loadConfig, type Config } from './config.ts'
import { createExecutorDb } from './db.ts'
import { createLogger } from './log.ts'
import { createProviders } from './providers/index.ts'
import { runWorker } from './worker.ts'

const log = createLogger()

async function main(config: Config): Promise<void> {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const controller = new AbortController()

  const shutdown = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) {
      // A second signal skips the grace period; claimed messages go back to the queue through release_stale_claims.
      log.error('executor forced to stop', { signal })
      process.exit(1)
    }
    log.info('executor stopping', { signal, grace_ms: config.shutdownGraceMs })
    controller.abort()
    // Messages still claimed after the grace period go back to the queue through release_stale_claims.
    setTimeout(() => {
      log.error('shutdown grace period exceeded')
      process.exit(1)
    }, config.shutdownGraceMs).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  log.info('executor started', { executorId: config.executorId, concurrency: config.concurrency })
  try {
    await runWorker(
      {
        db: createExecutorDb(client, config.executorId),
        providers: createProviders(),
        log,
        touchIntervalMs: config.touchIntervalMs,
        textTimeoutMs: config.textTimeoutMs,
        imageTimeoutMs: config.imageTimeoutMs,
      },
      config,
      controller.signal,
    )
  } catch (e) {
    // A failed slot must not leave the others serving without a sweep: stop them so the process exits.
    controller.abort()
    throw e
  }
  log.info('executor stopped')
}

let config: Config | undefined
try {
  config = loadConfig(process.env)
} catch (e) {
  // loadConfig names the invalid variables, never their values.
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
}

if (config) {
  try {
    await main(config)
    process.exitCode = 0
  } catch (e) {
    log.error('executor crashed', { error: e instanceof Error ? e.message : String(e) })
    process.exitCode = 1
  }
}
