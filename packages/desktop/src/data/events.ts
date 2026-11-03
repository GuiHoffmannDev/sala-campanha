import type { SupabaseClient } from '@supabase/supabase-js'
import { EVENT_COLUMNS, parseEvent, type SessionEvent } from '@sala/shared/events'
import type { ModelChoice } from '@sala/shared/agent'
import { gapFillSince } from '../lib/timeline.ts'

export type PostInput = {
  pieceId: string; text: string; mentionUserIds: string[]; model: ModelChoice | null; referenceAssetIds: string[]
}

export async function postMessage(client: SupabaseClient, input: PostInput): Promise<void> {
  const { error } = await client.rpc('post_message', {
    p_piece: input.pieceId, p_text: input.text, p_mention_user_ids: input.mentionUserIds,
    p_model: input.model, p_reference_asset_ids: input.referenceAssetIds,
  })
  if (error) throw error
}

// PostgREST returns at most this many rows per request (max_rows), so longer histories are read in pages.
const PAGE = 1000

/**
 * The piece's events with `id > afterId`, or also `created_at >= since` when given (rows that committed
 * after a higher id), by id. Rows the app cannot read are left out.
 */
export async function loadEvents(client: SupabaseClient, pieceId: string, afterId = 0, since?: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = []
  // With `since`, rows below afterId can match, so pages start from the bottom.
  let after = since ? 0 : afterId
  for (;;) {
    let query = client.from('session_events').select(EVENT_COLUMNS).eq('piece_id', pieceId).gt('id', after)
    // toISOString keeps the value free of the commas and parentheses `or` uses as syntax.
    if (since) query = query.or(`id.gt.${afterId},created_at.gte.${new Date(since).toISOString()}`)
    const { data, error } = await query.order('id').limit(PAGE)
    if (error) throw error
    for (const row of data) {
      const event = parseEvent(row)
      if (event) events.push(event)
    }
    if (data.length < PAGE) return events
    after = (data[data.length - 1] as { id: number }).id
  }
}

export type PieceHandlers = {
  onEvent(e: SessionEvent): void
  onVersion(): void
  onComment(): void
  onPiece(): void
  /** Runs on every join, reconnects included: the moment to load what was missed. */
  onSubscribed(): void
}

/** Live changes of one piece: its events (new and delivery updates), versions, comments and the piece row. */
export function subscribePiece(client: SupabaseClient, pieceId: string, h: PieceHandlers): () => void {
  const filter = `piece_id=eq.${pieceId}`
  const onEvent = (payload: { new: unknown }) => {
    const event = parseEvent(payload.new)
    if (event) h.onEvent(event)
  }
  // A fresh topic per call: supabase-js hands back an existing channel with the same topic, and
  // React may unmount and remount before the old one is gone.
  const channel = client.channel(`piece:${pieceId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'session_events', filter }, onEvent)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_events', filter }, onEvent)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'piece_versions', filter }, () => h.onVersion())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter }, () => h.onComment())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments', filter }, () => h.onComment())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pieces', filter: `id=eq.${pieceId}` }, () => h.onPiece())
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') h.onSubscribed()
  })
  return () => {
    void client.removeChannel(channel)
  }
}

/** Workspace-wide events, so a mention can notify someone reading a different piece. */
export function subscribeMentions(client: SupabaseClient, teamId: string, onEvent: (event: SessionEvent) => void): () => void {
  let active = true
  let channel: ReturnType<SupabaseClient['channel']> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let loading = false
  let again = false
  let afterId = 0
  let since: string | undefined
  let baseline: { id: number; since: string | undefined } | undefined
  const seen = new Set<number>()

  function receive(row: unknown, emit: boolean) {
    const event = parseEvent(row)
    if (!active || !event || event.team_id !== teamId) return
    if (seen.has(event.id)) return
    seen.add(event.id)
    if (emit) onEvent(event)
  }

  async function read(filter: string, emit: boolean) {
    let pageAfter = 0
    let nextId = afterId
    let nextSince = since
    while (active) {
      const { data, error } = await client.from('session_events').select(EVENT_COLUMNS)
        .eq('team_id', teamId).eq('kind', 'user_message').or(filter).gt('id', pageAfter).order('id').limit(PAGE)
      if (error) throw error
      if (!active) return
      for (const row of data) {
        receive(row, emit)
        nextId = Math.max(nextId, row.id)
        const lookback = gapFillSince([row])
        if (lookback && (!nextSince || lookback > nextSince)) nextSince = lookback
      }
      if (data.length < PAGE) {
        // Only a complete recovery may advance its cursor; live messages cannot hide a failed gap.
        afterId = nextId
        since = nextSince
        return
      }
      pageAfter = (data[data.length - 1] as { id: number }).id
    }
  }

  async function fill() {
    if (!active) return
    if (loading) { again = true; return }
    loading = true
    clearTimeout(retry)
    retry = undefined
    try {
      if (!channel) {
        // The server snapshot is the boundary: opening a workspace must not replay its old mentions.
        if (!baseline) {
          const { data, error } = await client.from('session_events').select(EVENT_COLUMNS)
            .eq('team_id', teamId).eq('kind', 'user_message').order('id', { ascending: false }).limit(1)
          if (error) throw error
          if (!active) return
          // A bad body must not erase the database cursor and replay valid older messages.
          afterId = data[0]?.id ?? 0
          since = gapFillSince(data)
          baseline = { id: afterId, since }
          if (data[0]) seen.add(afterId)
        }
        // Keep the first snapshot across failed seed reads; a new snapshot would swallow new mentions.
        if (baseline.since) await read(`and(id.lte.${baseline.id},created_at.gte.${baseline.since})`, false)
        if (!active) return
        channel = client.channel(`mentions:${teamId}:${crypto.randomUUID()}`)
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'session_events', filter: `team_id=eq.${teamId}`,
          }, (payload) => receive(payload.new, true))
          .subscribe((status) => { if (status === 'SUBSCRIBED') void fill() })
      } else {
        // Reuse the chat's 30 s overlap for IDs whose transactions committed out of order.
        await read(`id.gt.${afterId}${since ? `,created_at.gte.${since}` : ''}`, true)
      }
    } catch (error) {
      if (active) {
        console.error('could not restore mentions', error)
        retry = setTimeout(() => { retry = undefined; void fill() }, 3_000)
      }
    } finally {
      loading = false
      if (again && active) { again = false; void fill() }
    }
  }

  void fill()
  return () => {
    active = false
    clearTimeout(retry)
    if (channel) void client.removeChannel(channel)
  }
}
