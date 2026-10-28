import { setTimeout as sleep } from 'node:timers/promises'
import type { ExecutorDb } from './db.ts'
import { processClaim, type JobDeps } from './job.ts'
import { errorText } from './log.ts'

export type WorkerOptions = { concurrency: number; pollIntervalMs: number; staleAfterSeconds: number; sweepIntervalMs: number }

/** Job deps with one ExecutorDb per slot: slot `n` (1..concurrency) claims through `db(n)`. */
export type WorkerDeps = Omit<JobDeps, 'db'> & { db: (slot: number) => ExecutorDb }

/**
 * Serves the queue with `concurrency` slots until `signal` aborts. A round in
 * progress always finishes; idle waits end early on abort. Resolves when every
 * slot has stopped. Each slot has its own claim id, so a slot never acts on a
 * claim another slot of the same process took over.
 */
export async function runWorker(deps: WorkerDeps, opts: WorkerOptions, signal: AbortSignal): Promise<void> {
  const { log } = deps
  const sweepDb = deps.db(1)
  // The sleep rejects on abort; the loop then sees the aborted signal and stops.
  const wait = () => sleep(opts.pollIntervalMs, undefined, { signal }).catch(() => {})

  const sweep = async () => {
    try {
      const released = await sweepDb.releaseStale(opts.staleAfterSeconds)
      if (released > 0) log.info('released stale claims', { count: released })
    } catch (e) {
      log.error('release stale claims failed', { error: errorText(e) })
    }
  }

  const slot = async (n: number) => {
    const db = deps.db(n)
    const jobDeps: JobDeps = { ...deps, db }
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
      await processClaim(jobDeps, message, signal).catch((e) => log.error('process claim crashed', { piece_id: pieceId, error: errorText(e) }))
    }
  }

  // One sweep at a time: a tick while one is running is skipped, and shutdown waits for the running one.
  let sweeping: Promise<void> | null = null
  const tick = () => { sweeping ??= sweep().finally(() => { sweeping = null }) }
  tick()
  const timer = setInterval(tick, opts.sweepIntervalMs)
  try {
    await Promise.all(Array.from({ length: opts.concurrency }, (_, i) => slot(i + 1)))
  } finally {
    clearInterval(timer)
    await sweeping
  }
}
