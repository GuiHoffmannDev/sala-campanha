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
      if (!message) {
        await wait()
        continue
      }
      const pieceId = message.piece_id
      // A message claimed after the abort is still served: leaving it would hold the piece until the sweep.
      // processClaim logs its own errors; the catch keeps the slot alive if one still escapes.
      await processClaim(deps, message, signal).catch((e) => log.error('process claim crashed', { piece_id: pieceId, error: errorText(e) }))
    }
  }

  // One sweep at a time: a tick while one is running is skipped, and shutdown waits for the running one.
  let sweeping: Promise<void> | null = null
  const tick = () => { sweeping ??= sweep().finally(() => { sweeping = null }) }
  tick()
  const timer = setInterval(tick, opts.sweepIntervalMs)
  try {
    await Promise.all(Array.from({ length: opts.concurrency }, slot))
  } finally {
    clearInterval(timer)
    await sweeping
  }
}
