import { setTimeout as sleep } from 'node:timers/promises'
import { processClaim, type JobDeps } from './job.ts'

export type WorkerOptions = { concurrency: number; pollIntervalMs: number; staleAfterSeconds: number; sweepIntervalMs: number }

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Serves the queue with `concurrency` slots until `signal` aborts. A round in
 * progress always finishes; idle waits end early on abort. Resolves when every
 * slot has stopped.
 */
export async function runWorker(deps: JobDeps, opts: WorkerOptions, signal: AbortSignal): Promise<void> {
  const { db, log } = deps
  // The sleep rejects on abort; the loop then sees the aborted signal and stops.
  const wait = () => sleep(opts.pollIntervalMs, undefined, { signal }).catch(() => {})

  const sweep = async () => {
    try {
      const released = await db.releaseStale(opts.staleAfterSeconds)
      if (released > 0) log.info('released stale claims', { count: released })
    } catch (e) {
      log.error('release stale claims failed', { error: errorText(e) })
    }
  }

  const slot = async () => {
    while (!signal.aborted) {
      let message
      try {
        message = await db.claimNext()
      } catch (e) {
        log.error('claim next failed', { error: errorText(e) })
        await wait()
        continue
      }
      // A message claimed after the abort is still served: leaving it would hold the piece until the sweep.
      if (message) await processClaim(deps, message)
      else await wait()
    }
  }

  const sweeping = sweep()
  const timer = setInterval(sweep, opts.sweepIntervalMs)
  try {
    await Promise.all(Array.from({ length: opts.concurrency }, slot))
  } finally {
    clearInterval(timer)
    await sweeping
  }
}
