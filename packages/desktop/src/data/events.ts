import type { SupabaseClient } from '@supabase/supabase-js'
import { EVENT_COLUMNS, parseEvent, type SessionEvent } from '@sala/shared/events'

// PostgREST returns at most this many rows per request (max_rows), so longer histories are read in pages.
const PAGE = 1000

/** The piece's events with `id > afterId`, by id. Rows the app cannot read are left out. */
export async function loadEvents(client: SupabaseClient, pieceId: string, afterId = 0): Promise<SessionEvent[]> {
  const events: SessionEvent[] = []
  let after = afterId
  for (;;) {
    const { data, error } = await client.from('session_events').select(EVENT_COLUMNS)
      .eq('piece_id', pieceId).gt('id', after).order('id').limit(PAGE)
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
