import { createPieceFixture, dbClient, serviceClient, type PieceFixture } from '../helpers/supabase'

// The inbox is global: other tests leave queued messages behind. Settle them so
// each test only sees the messages it posts.
beforeEach(async () => {
  const { error } = await serviceClient().from('session_events').update({ delivery: 'done' }).in('delivery', ['queued', 'claimed'])
  if (error) throw new Error(`settle inbox failed: ${error.message}`)
})

async function post(f: PieceFixture, text = 'Gerar arte'): Promise<number> {
  const { data, error } = await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: text })
  if (error || !data) throw new Error(`post_message failed: ${error?.message}`)
  return data.id
}

async function claim(executor: string) {
  const { data, error } = await serviceClient().rpc('claim_next_message', { p_executor: executor })
  expect(error).toBeNull()
  return data as { id: number; delivery: string; claimed_by: string; claimed_at: string }[]
}

async function deliveryOf(id: number): Promise<string> {
  const { data, error } = await serviceClient().from('session_events').select('delivery').eq('id', id).single()
  if (error || !data) throw new Error(`select event failed: ${error?.message}`)
  return data.delivery
}

it('claim is exclusive under concurrency', async () => {
  const f = await createPieceFixture()
  const id = await post(f)
  const results = await Promise.all(['e1', 'e2', 'e3', 'e4', 'e5'].map(claim))
  const won = results.flat()
  expect(won).toHaveLength(1)
  expect(won[0]).toMatchObject({ id, delivery: 'claimed' })
  expect(won[0]?.claimed_at).toBeTruthy()
  expect(await claim('late')).toEqual([])
})

it('same piece is never claimed twice under concurrency', async () => {
  const f = await createPieceFixture()
  const first = await post(f, 'primeira')
  await post(f, 'segunda')
  const won = (await Promise.all(['e1', 'e2', 'e3', 'e4', 'e5'].map(claim))).flat()
  expect(won.map((e) => e.id)).toEqual([first])
})

it('a claim held by an open transaction is skipped, not waited on', async () => {
  // PostgREST may serialize parallel RPCs; two direct connections make the
  // lock contention real: c1 keeps its claim uncommitted while c2 claims.
  const f1 = await createPieceFixture()
  const f2 = await createPieceFixture(f1.t)
  const first = await post(f1, 'primeira')
  await post(f1, 'segunda')
  const otherPiece = await post(f2, 'outra peça')
  const ids = (r: { rows: { id: string }[] }) => r.rows.map((row) => Number(row.id))

  const c1 = await dbClient()
  const c2 = await dbClient()
  try {
    // Fail instead of hanging if c2 ever waits on c1's lock.
    await c2.query("set lock_timeout = '2s'")
    // Run as the executor's role, as in production.
    await c2.query('set role service_role')
    await c1.query('begin')
    await c1.query('set local role service_role')
    expect(ids(await c1.query("select id from public.claim_next_message('A')"))).toEqual([first])

    // c2 still sees `first` as queued but locked: it skips it, does not fall
    // through to `segunda` of the same piece, and takes the other piece.
    expect(ids(await c2.query("select id from public.claim_next_message('B')"))).toEqual([otherPiece])

    await c1.query('commit')
    expect(ids(await c2.query("select id from public.claim_next_message('C')"))).toEqual([])
    expect(await deliveryOf(first)).toBe('claimed')
  } finally {
    await c1.query('rollback').catch(() => undefined)
    await Promise.all([c1.end(), c2.end()])
  }
})

it('second message of same piece waits while first is claimed', async () => {
  const f = await createPieceFixture()
  const first = await post(f, 'primeira')
  const second = await post(f, 'segunda')

  expect((await claim('A')).map((e) => e.id)).toEqual([first])
  expect(await claim('B')).toEqual([])

  const done = await serviceClient().rpc('complete_message', { p_event: first, p_executor: 'A', p_status: 'done' })
  expect(done.error).toBeNull()
  expect(await deliveryOf(first)).toBe('done')

  expect((await claim('B')).map((e) => e.id)).toEqual([second])
})

it('messages of different pieces are claimed in parallel', async () => {
  const f1 = await createPieceFixture()
  const f2 = await createPieceFixture(f1.t)
  const ids = [await post(f1), await post(f2)]
  const won = (await Promise.all([claim('A'), claim('B')])).flat()
  expect(won.map((e) => e.id).sort((a, b) => a - b)).toEqual(ids)
})

it('people-only messages are never claimed', async () => {
  const f = await createPieceFixture()
  const { error } = await f.t.members.designer.client.rpc('post_message', {
    p_piece: f.pieceId, p_text: '@Gestor oi', p_mention_user_ids: [f.t.members.gestor.userId],
  })
  expect(error).toBeNull()
  expect(await claim('A')).toEqual([])
})

it('complete_message rejects other executor', async () => {
  const f = await createPieceFixture()
  const id = await post(f)
  await claim('A')
  const { error } = await serviceClient().rpc('complete_message', { p_event: id, p_executor: 'B', p_status: 'done' })
  expect(error?.code).toBe('42501')
  expect(await deliveryOf(id)).toBe('claimed')
})

it('complete_message accepts only done or failed', async () => {
  const f = await createPieceFixture()
  const id = await post(f)
  await claim('A')
  const { error } = await serviceClient().rpc('complete_message', { p_event: id, p_executor: 'A', p_status: 'queued' })
  expect(error?.code).toBe('22023')
  expect(await deliveryOf(id)).toBe('claimed')

  const failed = await serviceClient().rpc('complete_message', { p_event: id, p_executor: 'A', p_status: 'failed' })
  expect(failed.error).toBeNull()
  expect(await deliveryOf(id)).toBe('failed')
})

it('complete_message rejects a message that is not claimed', async () => {
  const f = await createPieceFixture()
  const id = await post(f)
  const { error } = await serviceClient().rpc('complete_message', { p_event: id, p_executor: 'A', p_status: 'done' })
  expect(error?.code).toBe('42501')
  expect(await deliveryOf(id)).toBe('queued')
})

it('authenticated cannot claim', async () => {
  const f = await createPieceFixture()
  await post(f)
  const { gestor } = f.t.members
  const calls = await Promise.all([
    gestor.client.rpc('claim_next_message', { p_executor: 'x' }),
    gestor.client.rpc('absorb_pending', { p_piece: f.pieceId, p_executor: 'x' }),
    gestor.client.rpc('touch_claim', { p_piece: f.pieceId, p_executor: 'x' }),
    gestor.client.rpc('complete_message', { p_event: 1, p_executor: 'x', p_status: 'done' }),
    gestor.client.rpc('release_stale_claims', { p_older_than: '0 seconds' }),
  ])
  for (const { error } of calls) expect(error?.code).toBe('42501')
  expect(await claim('A')).toHaveLength(1)
})

const absorb = (pieceId: string, executor: string) =>
  serviceClient().rpc('absorb_pending', { p_piece: pieceId, p_executor: executor })
const touch = (pieceId: string, executor: string) =>
  serviceClient().rpc('touch_claim', { p_piece: pieceId, p_executor: executor })
const complete = (id: number, executor: string) =>
  serviceClient().rpc('complete_message', { p_event: id, p_executor: executor, p_status: 'done' })

it('absorb_pending claims the queued messages of the piece, in order', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const first = await post(f, 'primeira')
  const second = await post(f, 'segunda')
  const third = await post(f, 'terceira')
  const otherPiece = await post(other, 'outra peça')
  expect((await claim('A')).map((e) => e.id)).toEqual([first])

  const { data, error } = await absorb(f.pieceId, 'A')
  expect(error).toBeNull()
  expect((data as { id: number; claimed_by: string }[]).map((e) => [e.id, e.claimed_by])).toEqual([[second, 'A'], [third, 'A']])

  // Another executor gets the other piece, never the absorbed messages.
  expect((await claim('B')).map((e) => e.id)).toEqual([otherPiece])
  expect(await claim('C')).toEqual([])
  expect(await deliveryOf(otherPiece)).toBe('claimed')
})

it('absorb_pending needs a claim on the piece', async () => {
  const f = await createPieceFixture()
  const id = await post(f)
  const { error } = await absorb(f.pieceId, 'A')
  expect(error?.code).toBe('42501')
  expect(await deliveryOf(id)).toBe('queued')

  // A claim of another executor does not count.
  await claim('B')
  expect((await absorb(f.pieceId, 'A')).error?.code).toBe('42501')
})

it('the piece is free again only after every absorbed message is completed', async () => {
  const f = await createPieceFixture()
  const first = await post(f, 'primeira')
  await claim('A')
  const second = await post(f, 'redirecionamento')
  await absorb(f.pieceId, 'A')
  const third = await post(f, 'depois')

  expect((await complete(first, 'A')).error).toBeNull()
  expect(await claim('B')).toEqual([]) // `second` is still claimed by A
  expect((await complete(second, 'A')).error).toBeNull()
  expect((await claim('B')).map((e) => e.id)).toEqual([third])
})

it('touch_claim renews every claim of the executor on the piece', async () => {
  const f = await createPieceFixture()
  const first = await post(f, 'primeira')
  await claim('A')
  const second = await post(f, 'redirecionamento')
  await absorb(f.pieceId, 'A')

  // Age both claims past the stale threshold, then renew them.
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  await serviceClient().from('session_events').update({ claimed_at: old }).in('id', [first, second])
  const { data, error } = await touch(f.pieceId, 'A')
  expect(error).toBeNull()
  expect(data).toBe(2)

  const released = await serviceClient().rpc('release_stale_claims', { p_older_than: '1 hour' })
  expect(released).toMatchObject({ error: null, data: 0 })
  expect([await deliveryOf(first), await deliveryOf(second)]).toEqual(['claimed', 'claimed'])
})

it('absorb_pending renews the claims the executor already holds', async () => {
  const f = await createPieceFixture()
  const first = await post(f, 'primeira')
  await claim('A')
  const second = await post(f, 'redirecionamento')

  // Without touch_claim, the original claim would go stale on its own.
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  await serviceClient().from('session_events').update({ claimed_at: old }).eq('id', first)
  expect((await absorb(f.pieceId, 'A')).error).toBeNull()

  const released = await serviceClient().rpc('release_stale_claims', { p_older_than: '1 hour' })
  expect(released).toMatchObject({ error: null, data: 0 })
  expect([await deliveryOf(first), await deliveryOf(second)]).toEqual(['claimed', 'claimed'])
})

it('touch_claim needs a claim of the same executor', async () => {
  const f = await createPieceFixture()
  await post(f)
  expect((await touch(f.pieceId, 'A')).error?.code).toBe('42501')
  await claim('B')
  expect((await touch(f.pieceId, 'A')).error?.code).toBe('42501')
})

it('release_stale_claims requeues old claims', async () => {
  const f = await createPieceFixture()
  const id = await post(f)
  await claim('A')

  const fresh = await serviceClient().rpc('release_stale_claims', { p_older_than: '1 hour' })
  expect(fresh).toMatchObject({ error: null, data: 0 })

  const { data, error } = await serviceClient().rpc('release_stale_claims', { p_older_than: '0 seconds' })
  expect(error).toBeNull()
  expect(data).toBe(1)
  const { data: row } = await serviceClient().from('session_events').select('delivery,claimed_by,claimed_at').eq('id', id).single()
  expect(row).toEqual({ delivery: 'queued', claimed_by: null, claimed_at: null })
  expect((await claim('B')).map((e) => e.id)).toEqual([id])
})
