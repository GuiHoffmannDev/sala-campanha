import { createPieceFixture, serviceClient, type PieceFixture } from '../helpers/supabase'

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
    gestor.client.rpc('pending_for_piece', { p_piece: f.pieceId }),
    gestor.client.rpc('complete_message', { p_event: 1, p_executor: 'x', p_status: 'done' }),
    gestor.client.rpc('release_stale_claims', { p_older_than: '0 seconds' }),
  ])
  for (const { error } of calls) expect(error?.code).toBe('42501')
  expect(await claim('A')).toHaveLength(1)
})

it('pending_for_piece lists queued messages of the piece in order', async () => {
  const f = await createPieceFixture()
  const other = await createPieceFixture(f.t)
  const first = await post(f, 'primeira')
  const second = await post(f, 'segunda')
  const third = await post(f, 'terceira')
  await post(other, 'outra peça')
  await claim('A') // claims `first` (oldest overall)

  const { data, error } = await serviceClient().rpc('pending_for_piece', { p_piece: f.pieceId })
  expect(error).toBeNull()
  expect((data as { id: number }[]).map((e) => e.id)).toEqual([second, third])
  expect(first).toBeLessThan(second)
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
