import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'
import { createPieceFixture } from './supabase'

export type Change = RealtimePostgresChangesPayload<Record<string, unknown>>
export type Subscription = { table: string; filter?: string }
export type JoinStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT'

const WAIT_MS = 5_000
// Extra time after the expected changes arrive, so a leak to another team has a chance to show up.
const GRACE_MS = 1_000

const clients: SupabaseClient[] = []

/** Removes every channel opened by `listen` or `joinPresence`. Call it in `afterEach`. */
export async function closeChannels(): Promise<void> {
  await Promise.all(clients.splice(0).map((c) => c.removeAllChannels()))
}

/** Subscribes `client` to postgres_changes and resolves once the channel is live. */
export async function listen(client: SupabaseClient, subs: Subscription[]): Promise<Change[]> {
  clients.push(client)
  // Realtime checks RLS with the user's JWT, so the channel must carry it.
  await client.realtime.setAuth()
  const received: Change[] = []
  const channel = client.channel(`test-${crypto.randomUUID()}`)
  for (const s of subs) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: s.table, filter: s.filter }, (p) => received.push(p))
  }
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve()
      else if (status !== 'CLOSED') reject(new Error(`subscribe failed: ${status} ${err?.message ?? ''}`))
    })
  })
  return received
}

/** Joins the private presence channel `topic` and resolves with the first join outcome. */
export async function joinPresence(client: SupabaseClient, topic: string): Promise<JoinStatus> {
  clients.push(client)
  // Private channels are authorized by the RLS policies on realtime.messages, using this JWT.
  await client.realtime.setAuth()
  // Realtime checks the presence policies only when the channel listens to presence;
  // without a listener it asks for broadcast access, which no policy grants.
  const channel = client.channel(topic, { config: { private: true } }).on('presence', { event: 'sync' }, () => {})
  return new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status !== 'CLOSED') resolve(status)
    })
  })
}

/** Changes about rows that do not belong to `teamId`. */
export function foreign(changes: Change[], teamId: string): Change[] {
  return changes.filter((c) => (c.new as { team_id?: string }).team_id !== teamId)
}

/** Waits up to 5 s for `check`, then a grace period so late leaks can show up. */
export async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, GRACE_MS))
}

/**
 * Right after `db reset`, Realtime starts replication on the first
 * subscription and drops changes made before it is up. Posts probes until
 * one arrives, so live tests measure RLS filtering, not cold start.
 * Use as `beforeAll(warmUpRealtime, 40_000)`.
 */
export async function warmUpRealtime(): Promise<void> {
  const f = await createPieceFixture()
  const received = await listen(f.t.members.designer.client, [{ table: 'session_events', filter: `piece_id=eq.${f.pieceId}` }])
  const deadline = Date.now() + 25_000
  while (received.length === 0) {
    if (Date.now() > deadline) throw new Error('Realtime delivered no change within 25s')
    await f.t.members.designer.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'aquecimento' })
    await new Promise((r) => setTimeout(r, 1_000))
  }
  await closeChannels()
}
