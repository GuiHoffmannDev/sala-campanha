import type { SupabaseClient } from '@supabase/supabase-js'
import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { subscribeMentions } from '../../packages/desktop/src/data/events.ts'
import { shouldNotify } from '../../packages/desktop/src/lib/presence.ts'

const message = (id: number, changes: Partial<SessionEvent> = {}): SessionEvent => ({
  id, team_id: 'team', piece_id: `piece-${id}`, author_id: 'other', kind: 'user_message',
  body: { text: '@me See this', model: null, reference_asset_ids: [] }, mention_user_ids: ['me'],
  to_agent: false, delivery: 'not_applicable', created_at: '2026-11-03T12:00:00Z', ...changes,
} as SessionEvent)

type Response = { data: SessionEvent[] | null; error: Error | null }

function database(initial: SessionEvent[] = []) {
  const rows = [...initial]
  const queries: { equals: Record<string, string>; filter?: string }[] = []
  let live!: (payload: { new: SessionEvent }) => void
  let status: ((value: string) => void) | undefined
  let nextResponse: (() => Promise<Response>) | undefined
  const channel = {
    on: vi.fn((_type, _filter, callback) => { live = callback; return channel }),
    subscribe: vi.fn((callback) => { status = callback; return channel }),
  }
  const from = vi.fn(() => {
    const equals: Record<string, string> = {}
    let after = 0
    let filter: string | undefined
    let ascending = true
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { equals[column] = value; return query },
      gt: (_column: string, value: number) => { after = value; return query },
      or: (value: string) => { filter = value; return query },
      order: (_column: string, options?: { ascending: boolean }) => { ascending = options?.ascending ?? true; return query },
      limit: (count: number): Promise<Response> => {
        queries.push({ equals, filter })
        const response = nextResponse
        nextResponse = undefined
        if (response) return response()
        const matches = (row: SessionEvent): boolean => {
          if (row.id <= after || Object.entries(equals).some(([key, value]) => row[key as keyof SessionEvent] !== value)) return false
          if (!filter) return true
          const id = Number(filter.match(/id\.(?:gt|lte)\.(\d+)/)?.[1])
          const since = filter.match(/created_at\.gte\.([^,)]+)/)?.[1]
          const recent = since !== undefined && Date.parse(row.created_at) >= Date.parse(since)
          return filter.startsWith('and(') ? row.id <= id && recent : row.id > id || recent
        }
        return Promise.resolve({ data: rows.filter(matches).sort((a, b) => ascending ? a.id - b.id : b.id - a.id).slice(0, count), error: null })
      },
    }
    return query
  })
  const client = { from, channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok') }
  return {
    rows, queries, client: client as unknown as SupabaseClient,
    channel, removed: client.removeChannel,
    emit: (event: SessionEvent) => live({ new: event }),
    subscribed: () => status?.('SUBSCRIBED'),
    defer: (response: () => Promise<Response>) => { nextResponse = response },
  }
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('recovers initial join and reconnect gaps without replaying old history or duplicating live events', async () => {
  const db = database([message(1)])
  const received: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  expect(received).toEqual([])
  db.rows.push(message(2))
  db.subscribed()
  await settle()
  expect(received).toEqual([2])
  db.rows.push(message(3))
  db.emit(message(3))
  db.rows.push(message(4))
  db.subscribed()
  await settle()
  db.subscribed()
  await settle()
  expect(received).toEqual([2, 3, 4])
  expect(db.channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ filter: 'team_id=eq.team' }), expect.any(Function))
  stop()
})

it('seeds every recent baseline page, catches lower IDs committed late and scopes every query to the workspace', async () => {
  const db = database(Array.from({ length: 1005 }, (_, i) => message(i + 10)))
  const notices: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => { if (shouldNotify(event, 'me')) notices.push(event.id) })
  await settle()
  db.subscribed()
  await settle()
  expect(notices).toEqual([])
  db.rows.push(message(5), message(1015), message(1016, { author_id: 'me' }),
    message(1017, { mention_user_ids: [] }), message(1018, { team_id: 'other-team' }))
  db.subscribed()
  await settle()
  db.emit(message(1018, { team_id: 'other-team' }))
  expect(notices).toEqual([5, 1015])
  expect(db.queries.length).toBeGreaterThan(4)
  expect(db.queries.every((query) => query.equals.team_id === 'team')).toBe(true)
  stop()
})

it('retries failed baseline and gap reads, then cancels retries on cleanup', async () => {
  const db = database([message(1)])
  const received: number[] = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.defer(async () => ({ data: null, error: new Error('offline') }))
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  expect(db.channel.subscribe).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(3000)
  expect(db.channel.subscribe).toHaveBeenCalledOnce()
  db.defer(async () => ({ data: null, error: new Error('offline') }))
  db.subscribed()
  await settle()
  db.rows.push(message(2))
  await vi.advanceTimersByTimeAsync(3000)
  expect(received).toEqual([2])
  db.defer(async () => ({ data: null, error: new Error('offline') }))
  db.subscribed()
  await settle()
  stop()
  const queries = db.queries.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(db.queries).toHaveLength(queries)
  expect(db.removed).toHaveBeenCalledOnce()
})

it('recovers more than one page and deduplicates live events arriving during a recovery read', async () => {
  const db = database()
  const received: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  db.rows.push(...Array.from({ length: 1005 }, (_, i) => message(i + 1)))
  db.subscribed()
  await settle()
  expect(received).toEqual(db.rows.map((event) => event.id))
  let resolve!: (response: Response) => void
  db.defer(() => new Promise((done) => { resolve = done }))
  db.subscribed()
  await settle()
  db.emit(message(1006))
  resolve({ data: [message(1006)], error: null })
  await settle()
  expect(received.filter((id) => id === 1006)).toHaveLength(1)
  stop()
})

it('does not deliver live or pending recovery results after cleanup', async () => {
  const db = database()
  const received: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  let resolve!: (response: Response) => void
  db.defer(() => new Promise((done) => { resolve = done }))
  db.subscribed()
  await settle()
  stop()
  db.emit(message(1))
  resolve({ data: [message(2)], error: null })
  await settle()
  expect(received).toEqual([])
})

it('does not create a channel after cleanup while its baseline is still loading', async () => {
  const db = database()
  let resolve!: (response: Response) => void
  db.defer(() => new Promise((done) => { resolve = done }))
  const stop = subscribeMentions(db.client, 'team', () => {})
  stop()
  resolve({ data: [], error: null })
  await settle()
  expect(db.channel.subscribe).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not replay old valid messages when the latest baseline row has an invalid body', async () => {
  const invalid = { ...message(2), body: {} } as SessionEvent
  const db = database([message(1), invalid])
  const received: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  db.subscribed()
  await settle()
  expect(received).toEqual([])
  db.rows.push(message(3))
  db.subscribed()
  await settle()
  expect(received).toEqual([3])
  stop()
})

it('keeps its first baseline when seeding history fails instead of swallowing messages posted before retry', async () => {
  const db = database([message(1)])
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.defer(async () => {
    db.defer(async () => ({ data: null, error: new Error('offline while seeding') }))
    return { data: [message(1)], error: null }
  })
  const received: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  db.rows.push(message(2))
  await vi.advanceTimersByTimeAsync(3000)
  db.subscribed()
  await settle()
  expect(received).toEqual([2])
  stop()
})

it('keeps the failed recovery cursor when a newer live event arrives during its query', async () => {
  const db = database([message(1)])
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const received: number[] = []
  const stop = subscribeMentions(db.client, 'team', (event) => received.push(event.id))
  await settle()
  db.rows.push(message(2, { created_at: '2026-11-03T12:01:00Z' }))
  let resolve!: (response: Response) => void
  db.defer(() => new Promise((done) => { resolve = done }))
  db.subscribed()
  await settle()
  const later = message(3, { created_at: '2026-11-03T13:00:00Z' })
  db.rows.push(later)
  db.emit(later)
  resolve({ data: null, error: new Error('offline during recovery') })
  await settle()
  await vi.advanceTimersByTimeAsync(3000)
  expect(received).toEqual([3, 2])
  stop()
})
