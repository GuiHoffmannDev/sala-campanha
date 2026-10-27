import type { SupabaseClient } from '@supabase/supabase-js'
import type { PieceKind, PieceStatus, Provider } from '@sala/shared'

export type InboxMessage = {
  id: number
  piece_id: string
  team_id: string
  author_id: string | null
  body: { text: string; model: unknown; reference_asset_ids: string[] }
}

export type HistoryMessage = { id: number; author: string; text: string; model: unknown; reference_asset_ids: string[] }

export type PieceContext = {
  piece: { id: string; team_id: string; campaign_id: string; title: string; kind: PieceKind; status: PieceStatus }
  campaignName: string
  history: HistoryMessage[]
  latestVersion: { id: string; number: number; image_path: string | null; caption: string | null } | null
  lastImagePrompt: string | null
  keyedProviders: Provider[]
  memberNames: Record<string, string>
}

export type AgentEventKind = 'agent_started' | 'agent_result' | 'agent_error'

export type ExecutorDb = {
  claimNext(): Promise<InboxMessage | null>
  absorbPending(pieceId: string): Promise<InboxMessage[]>
  touchClaim(pieceId: string): Promise<void>
  complete(eventId: number, status: 'done' | 'failed'): Promise<void>
  releaseStale(olderThanSeconds: number): Promise<number>
  addAgentEvent(sourceEvent: number, kind: AgentEventKind, body: object): Promise<void>
  addAgentVersion(pieceId: string, imagePath: string | null, caption: string | null, sourceEvent: number): Promise<{ id: string; number: number }>
  getProviderKey(teamId: string, provider: Provider): Promise<string | null>
  loadPieceContext(pieceId: string): Promise<PieceContext>
  loadReferencePaths(teamId: string, campaignId: string, ids: string[]): Promise<{ id: string; storage_path: string }[]>
  downloadFile(path: string): Promise<{ bytes: Uint8Array; mimeType: string }>
  uploadFile(path: string, bytes: Uint8Array, mimeType: string): Promise<void>
  removeFile(path: string): Promise<void>
  answeredMessages(pieceId: string, ids: number[]): Promise<Set<number>>
}

/** The executor no longer holds the claim (released as stale or taken by another executor). */
export class ClaimLostError extends Error {
  constructor(operation: string) {
    super(`${operation}: claim lost`)
    this.name = 'ClaimLostError'
  }
}

const BUCKET = 'team-files'
const HISTORY_LIMIT = 30
const NO_AUTHOR = 'Alguém'
const INBOX_COLUMNS = 'id, piece_id, team_id, author_id, body'

type SupabaseError = { message: string; code?: string } | null

/**
 * Returns `data`, or throws a named Error. Only the claim RPCs (`claimRpc`) map
 * 42501 to ClaimLostError; elsewhere 42501 is a missing privilege, not a lost claim.
 */
function check<T>(operation: string, result: { data: T; error: SupabaseError }, claimRpc = false): T {
  if (result.error) {
    if (claimRpc && result.error.code === '42501') throw new ClaimLostError(operation)
    throw new Error(`${operation} failed: ${result.error.message}`)
  }
  return result.data
}

const toInbox = (row: InboxMessage): InboxMessage =>
  ({ id: row.id, piece_id: row.piece_id, team_id: row.team_id, author_id: row.author_id, body: row.body })

export function createExecutorDb(client: SupabaseClient, executorId: string): ExecutorDb {
  const storage = () => client.storage.from(BUCKET)

  return {
    async claimNext() {
      const rows = check('claimNext', await client.rpc('claim_next_message', { p_executor: executorId })) as InboxMessage[]
      return rows[0] ? toInbox(rows[0]) : null
    },

    async absorbPending(pieceId) {
      const rows = check('absorbPending', await client.rpc('absorb_pending', { p_piece: pieceId, p_executor: executorId }), true) as InboxMessage[]
      return rows.map(toInbox)
    },

    async touchClaim(pieceId) {
      check('touchClaim', await client.rpc('touch_claim', { p_piece: pieceId, p_executor: executorId }), true)
    },

    async complete(eventId, status) {
      check('complete', await client.rpc('complete_message', { p_event: eventId, p_executor: executorId, p_status: status }), true)
    },

    async releaseStale(olderThanSeconds) {
      return check('releaseStale', await client.rpc('release_stale_claims', { p_older_than: `${olderThanSeconds} seconds` })) as number
    },

    async addAgentEvent(sourceEvent, kind, body) {
      check('addAgentEvent', await client.rpc('add_agent_event', {
        p_source_event: sourceEvent, p_executor: executorId, p_kind: kind, p_body: body,
      }), true)
    },

    async addAgentVersion(pieceId, imagePath, caption, sourceEvent) {
      const v = check('addAgentVersion', await client.rpc('add_agent_version', {
        p_piece: pieceId, p_image_path: imagePath, p_caption: caption, p_source_event: sourceEvent, p_executor: executorId,
      }), true) as { id: string; number: number }
      return { id: v.id, number: v.number }
    },

    async getProviderKey(teamId, provider) {
      return check('getProviderKey', await client.rpc('get_provider_key_for_executor', { p_team: teamId, p_provider: provider })) as string | null
    },

    async loadPieceContext(pieceId) {
      const op = 'loadPieceContext'
      const piece = check(op, await client.from('pieces')
        .select('id, team_id, campaign_id, title, kind, status, campaigns(name)')
        .eq('id', pieceId).single()) as unknown as PieceContext['piece'] & { campaigns: { name: string } }

      const [members, messages, version, result, keys] = await Promise.all([
        client.from('team_members').select('user_id, display_name').eq('team_id', piece.team_id),
        client.from('session_events').select(INBOX_COLUMNS)
          .eq('piece_id', pieceId).eq('kind', 'user_message').eq('to_agent', true)
          .in('delivery', ['claimed', 'done', 'failed'])
          .order('id', { ascending: false }).limit(HISTORY_LIMIT),
        client.from('piece_versions').select('id, number, image_path, caption')
          .eq('piece_id', pieceId).order('number', { ascending: false }).limit(1).maybeSingle(),
        // Latest result that carried an image prompt: text-only rounds keep the previous one.
        client.from('session_events').select('body')
          .eq('piece_id', pieceId).eq('kind', 'agent_result').not('body->>image_prompt', 'is', null)
          .order('id', { ascending: false }).limit(1).maybeSingle(),
        client.from('provider_keys').select('provider').eq('team_id', piece.team_id).order('provider'),
      ])

      const memberNames = Object.fromEntries(
        (check(op, members) as { user_id: string; display_name: string }[]).map((m) => [m.user_id, m.display_name]),
      )
      const history = (check(op, messages) as InboxMessage[]).reverse().map((m) => ({
        id: m.id,
        author: (m.author_id && memberNames[m.author_id]) || NO_AUTHOR,
        text: m.body.text,
        model: m.body.model,
        reference_asset_ids: m.body.reference_asset_ids,
      }))
      const lastResult = check(op, result) as { body: { image_prompt: string } } | null

      return {
        piece: { id: piece.id, team_id: piece.team_id, campaign_id: piece.campaign_id, title: piece.title, kind: piece.kind, status: piece.status },
        campaignName: piece.campaigns.name,
        history,
        latestVersion: check(op, version) as PieceContext['latestVersion'],
        lastImagePrompt: lastResult?.body.image_prompt ?? null,
        keyedProviders: (check(op, keys) as { provider: Provider }[]).map((k) => k.provider),
        memberNames,
      }
    },

    async loadReferencePaths(teamId, campaignId, ids) {
      if (ids.length === 0) return []
      const rows = check('loadReferencePaths', await client.from('reference_assets').select('id, storage_path')
        .eq('team_id', teamId).eq('campaign_id', campaignId).in('id', ids)) as { id: string; storage_path: string }[]
      const byId = new Map(rows.map((r) => [r.id, r]))
      return ids.flatMap((id) => byId.get(id) ?? [])
    },

    async downloadFile(path) {
      const blob = check('downloadFile', await storage().download(path)) as Blob
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type }
    },

    async uploadFile(path, bytes, mimeType) {
      check('uploadFile', await storage().upload(path, bytes, { contentType: mimeType, upsert: false }))
    },

    async removeFile(path) {
      check('removeFile', await storage().remove([path]))
    },

    /**
     * The ids in `ids` that an earlier round already answered with a stored version.
     * A round's version has the round's last message as `source_event_id`, and its
     * `agent_started` lists every message of the round, in order. This catches a round
     * whose messages went back to the queue after the version was stored.
     */
    async answeredMessages(pieceId, ids) {
      if (ids.length === 0) return new Set()
      const op = 'answeredMessages'
      // Versions and agent_started events are always newer than the messages they answer.
      const since = Math.min(...ids)
      const [versions, started] = await Promise.all([
        client.from('piece_versions').select('source_event_id')
          .eq('piece_id', pieceId).eq('origin', 'agente').gte('source_event_id', since),
        client.from('session_events').select('body')
          .eq('piece_id', pieceId).eq('kind', 'agent_started').gt('id', since),
      ])
      const sources = new Set((check(op, versions) as { source_event_id: number }[]).map((v) => v.source_event_id))
      const answered = new Set<number>()
      for (const { body } of check(op, started) as { body: { message_ids: number[] } }[]) {
        if (sources.has(body.message_ids.at(-1)!)) for (const id of body.message_ids) answered.add(id)
      }
      return new Set(ids.filter((id) => answered.has(id)))
    },
  }
}
