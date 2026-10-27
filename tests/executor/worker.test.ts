import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Provider } from '../../packages/shared/src/domain'
import { createExecutorDb, type ExecutorDb, type InboxMessage } from '../../packages/executor/src/db.ts'
import type { JobDeps } from '../../packages/executor/src/job.ts'
import { createLogger } from '../../packages/executor/src/log.ts'
import { runWorker, type WorkerOptions } from '../../packages/executor/src/worker.ts'
import { FAKE_IMAGE, fakeProviders } from '../helpers/fake-providers'
import { createPieceFixture, serviceClient, type PieceFixture } from '../helpers/supabase'

const WORKER_EXECUTOR = 'worker-test-executor'
const KEYS: Partial<Record<Provider, string>> = {
  anthropic: 'sk-ant-worker-test-1234567890abcdef',
  gemini: 'gemini-worker-test-1234567890abcdef',
}
const OPTS: WorkerOptions = { concurrency: 2, pollIntervalMs: 50, staleAfterSeconds: 300, sweepIntervalMs: 60_000 }

beforeAll(async () => {
  // Outros arquivos de teste deixam mensagens 'queued' que claim_next_message pegaria.
  // Os arquivos rodam em sequência, então neste ponto essas mensagens são sobra: marcá-las 'failed'.
  const { error } = await serviceClient().from('session_events').update({ delivery: 'failed' }).in('delivery', ['queued', 'claimed'])
  expect(error).toBeNull()
})

async function keyedPiece(f?: PieceFixture): Promise<PieceFixture> {
  const piece = await createPieceFixture(f?.t)
  if (!f) {
    for (const [provider, key] of Object.entries(KEYS)) {
      const { error } = await piece.t.members.admin.client.rpc('set_provider_key', { p_team: piece.t.teamId, p_provider: provider, p_key: key })
      expect(error).toBeNull()
    }
  }
  return piece
}

async function post(f: PieceFixture, text = 'Gerar versão'): Promise<number> {
  const { data, error } = await f.t.members.gestor.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: text, p_model: null, p_reference_asset_ids: [],
  })
  if (error || !data) throw new Error(`post_message failed: ${error?.message}`)
  return data.id
}

async function delivery(id: number): Promise<string> {
  const { data, error } = await serviceClient().from('session_events').select('delivery').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data.delivery
}

async function versionCount(f: PieceFixture): Promise<number> {
  const { count, error } = await serviceClient().from('piece_versions').select('id', { count: 'exact', head: true }).eq('piece_id', f.pieceId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out')
    await sleep(50)
  }
}

function start(p: ReturnType<typeof fakeProviders>, o: { db?: ExecutorDb; opts?: Partial<WorkerOptions> } = {}) {
  const lines: string[] = []
  const deps: JobDeps = {
    db: o.db ?? createExecutorDb(serviceClient(), WORKER_EXECUTOR),
    providers: p.providers, log: createLogger((line) => lines.push(line)),
    touchIntervalMs: 60_000, textTimeoutMs: 5_000, imageTimeoutMs: 5_000,
  }
  const controller = new AbortController()
  const done = runWorker(deps, { ...OPTS, ...o.opts }, controller.signal)
  return { lines, done, stop: async () => { controller.abort(); await done } }
}

it('end to end: a posted message becomes a version', async () => {
  const f = await keyedPiece()
  const w = start(fakeProviders())
  try {
    const id = await post(f)
    await waitFor(async () => (await delivery(id)) === 'done')
    expect(await versionCount(f)).toBe(1)
  } finally {
    await w.stop()
  }
})

it('two pieces are served in parallel', async () => {
  const a = await keyedPiece()
  const b = await keyedPiece(a)
  const spans: { start: number; end: number }[] = []
  const p = fakeProviders({
    image: async () => {
      const span = { start: Date.now(), end: 0 }
      spans.push(span)
      await sleep(500)
      span.end = Date.now()
      return FAKE_IMAGE
    },
  })
  const ids = [await post(a), await post(b)]
  const w = start(p)
  try {
    await waitFor(async () => (await Promise.all(ids.map(delivery))).every((d) => d === 'done'))
  } finally {
    await w.stop()
  }
  // In series the second image would start after the first ended.
  expect(spans).toHaveLength(2)
  expect(Math.max(...spans.map((s) => s.start))).toBeLessThan(Math.min(...spans.map((s) => s.end)))
})

it('worker keeps serving after a failed job', async () => {
  const noKey = await createPieceFixture()
  const ok = await keyedPiece()
  const failedId = await post(noKey)
  const okId = await post(ok)
  const w = start(fakeProviders(), { opts: { concurrency: 1 } })
  try {
    await waitFor(async () => (await delivery(okId)) === 'done')
  } finally {
    await w.stop()
  }
  expect(await delivery(failedId)).toBe('failed')
  expect(await versionCount(noKey)).toBe(0)
  expect(await versionCount(ok)).toBe(1)
})

it('abort waits for the running round to finish', async () => {
  const f = await keyedPiece()
  let imageStarted!: () => void
  const started = new Promise<void>((resolve) => { imageStarted = resolve })
  const p = fakeProviders({
    image: async () => {
      imageStarted()
      await sleep(300)
      return FAKE_IMAGE
    },
  })
  const w = start(p)
  const id = await post(f)
  await started
  await w.stop()
  expect(await versionCount(f)).toBe(1)
  expect(await delivery(id)).toBe('done')
})

it('claimNext error does not kill the slot', async () => {
  const f = await keyedPiece()
  const real = createExecutorDb(serviceClient(), WORKER_EXECUTOR)
  let failures = 0
  const db: ExecutorDb = {
    ...real,
    claimNext: async () => {
      if (failures++ === 0) throw new Error('network down')
      return real.claimNext()
    },
  }
  const w = start(fakeProviders(), { db, opts: { concurrency: 1 } })
  try {
    const id = await post(f)
    await waitFor(async () => (await delivery(id)) === 'done')
  } finally {
    await w.stop()
  }
  expect(w.lines.map((l) => JSON.parse(l))).toContainEqual(expect.objectContaining({ level: 'error', msg: 'claim next failed', error: 'network down' }))
})

it('sweeps stale claims at start and on the interval; sweep errors are only logged', async () => {
  let sweeps = 0
  const db = {
    claimNext: async () => null,
    releaseStale: async (seconds: number) => {
      sweeps++
      expect(seconds).toBe(300)
      throw new Error('db down')
    },
  } as unknown as ExecutorDb
  const w = start(fakeProviders(), { db, opts: { sweepIntervalMs: 50 } })
  await sleep(10)
  expect(sweeps).toBe(1)
  await sleep(200)
  await w.stop()
  expect(sweeps).toBeGreaterThanOrEqual(3)
  expect(w.lines.map((l) => JSON.parse(l))).toContainEqual(expect.objectContaining({ level: 'error', msg: 'release stale claims failed', error: 'db down' }))
})

it('abort ends idle slots without waiting for the poll interval', async () => {
  const db = { claimNext: async () => null, releaseStale: async () => 0 } as unknown as ExecutorDb
  const w = start(fakeProviders(), { db, opts: { pollIntervalMs: 60_000 } })
  await sleep(20)
  const t = Date.now()
  await w.stop()
  expect(Date.now() - t).toBeLessThan(1_000)
})

it('abort leaves messages posted during the last round queued', async () => {
  const f = await keyedPiece()
  let imageStarted!: () => void
  const started = new Promise<void>((resolve) => { imageStarted = resolve })
  const w = start(fakeProviders({
    image: async () => {
      imageStarted()
      await sleep(300)
      return FAKE_IMAGE
    },
  }))
  const first = await post(f)
  await started
  const redirect = await post(f, 'Mudar o fundo')
  await w.stop()
  try {
    expect(await delivery(first)).toBe('done')
    expect(await delivery(redirect)).toBe('queued')
    expect(await versionCount(f)).toBe(1)
  } finally {
    // Later tests must not pick up this leftover.
    const { error } = await serviceClient().from('session_events').update({ delivery: 'failed' }).eq('id', redirect)
    expect(error).toBeNull()
  }
})

it('an error escaping processClaim does not kill the slot', async () => {
  let claims = 0
  const db = {
    claimNext: async () => (claims++ === 0 ? ({ id: 1, piece_id: 'piece-1' } as InboxMessage) : null),
    absorbPending: async () => { throw new Error('db down') },
    releaseStale: async () => 0,
  } as unknown as ExecutorDb
  const lines: string[] = []
  let thrown = false
  const log = createLogger((line) => {
    // The first 'claim failed' line throws, so the error escapes processClaim.
    if (!thrown && line.includes('"msg":"claim failed"')) {
      thrown = true
      throw new Error('log sink down')
    }
    lines.push(line)
  })
  const controller = new AbortController()
  const done = runWorker(
    { db, providers: fakeProviders().providers, log, touchIntervalMs: 60_000, textTimeoutMs: 5_000, imageTimeoutMs: 5_000 },
    { ...OPTS, concurrency: 1 },
    controller.signal,
  )
  await waitFor(async () => claims >= 2)
  controller.abort()
  await done
  expect(lines.map((l) => JSON.parse(l))).toContainEqual(
    expect.objectContaining({ level: 'error', msg: 'process claim crashed', piece_id: 'piece-1', error: 'log sink down' }),
  )
})

it('main exits with 0 after SIGTERM', async () => {
  const child = spawn(process.execPath, ['packages/executor/src/main.ts'], {
    env: { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, EXECUTOR_CONCURRENCY: '1' },
  })
  let output = ''
  let signaled = false
  child.stdout.on('data', (d) => {
    output += d
    // Only one signal: a second one forces exit 1.
    if (!signaled && output.includes('executor started')) {
      signaled = true
      child.kill('SIGTERM')
    }
  })
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  expect(code).toBe(0)
  expect(output).toContain('executor stopped')
  expect(output).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY)
})

it('main exits on missing config without printing secrets', async () => {
  const child = spawn(process.execPath, ['packages/executor/src/main.ts'], { env: { SUPABASE_SERVICE_ROLE_KEY: 'secret-value' } })
  let output = ''
  let stderr = ''
  child.stdout.on('data', (d) => { output += d })
  child.stderr.on('data', (d) => { stderr += d })
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  expect(code).not.toBe(0)
  expect(stderr).toContain('SUPABASE_URL')
  expect(stderr + output).not.toContain('secret-value')
})
