import { z } from 'zod'
import { AgentErrorBodySchema, AgentResultBodySchema, AgentStartedBodySchema } from './agent.ts'
import { DeliveryStatusSchema, PieceStatusSchema, VersionPhaseSchema, type DeliveryStatus, type EventKind } from './domain.ts'

// Conversation events as the app reads them from session_events. Body fields are the ones written by
// the migrations 0004 (post_message), 0006 (versions, status, approval) and 0007 (comments), and by the
// executor for the agent events (packages/executor/src/job.ts); 0009 only checks that the body is an object.

// claimed_by and claimed_at stay out: they are internal to the executor.
export const EVENT_COLUMNS = 'id, piece_id, team_id, author_id, kind, body, to_agent, mention_user_ids, delivery, created_at'

export type SessionEventRow = {
  id: number
  piece_id: string
  team_id: string
  author_id: string | null
  kind: EventKind
  body: unknown
  to_agent: boolean
  mention_user_ids: string[]
  delivery: DeliveryStatus
  created_at: string
}

// model is the p_model given to post_message, null when none was sent.
export const UserMessageBodySchema = z.object({ text: z.string(), model: z.unknown(), reference_asset_ids: z.array(z.string()) })
export const StatusChangedBodySchema = z.object({ from: PieceStatusSchema, to: PieceStatusSchema })
export const VersionAddedBodySchema = z.object({ version_id: z.string(), number: z.number().int(), phase: VersionPhaseSchema })
export const ApprovalBodySchema = z.object({ version_id: z.string(), from: PieceStatusSchema, to: PieceStatusSchema })
export const CommentBodySchema = z.object({ comment_id: z.string(), version_id: z.string(), parent_id: z.string().nullable() })

const RowSchema = z.object({
  id: z.number().int(),
  piece_id: z.string(),
  team_id: z.string(),
  author_id: z.string().nullable(),
  to_agent: z.boolean(),
  mention_user_ids: z.array(z.string()),
  delivery: DeliveryStatusSchema,
  created_at: z.string(),
})

const SessionEventSchema = z.discriminatedUnion('kind', [
  RowSchema.extend({ kind: z.literal('user_message'), body: UserMessageBodySchema }),
  RowSchema.extend({ kind: z.literal('agent_started'), body: AgentStartedBodySchema }),
  RowSchema.extend({ kind: z.literal('agent_result'), body: AgentResultBodySchema }),
  RowSchema.extend({ kind: z.literal('agent_error'), body: AgentErrorBodySchema }),
  RowSchema.extend({ kind: z.literal('status_changed'), body: StatusChangedBodySchema }),
  RowSchema.extend({ kind: z.literal('version_added'), body: VersionAddedBodySchema }),
  RowSchema.extend({ kind: z.literal('approval'), body: ApprovalBodySchema }),
  RowSchema.extend({ kind: z.literal('comment'), body: CommentBodySchema }),
])

/** A session_events row with its body typed by kind. */
export type SessionEvent = z.infer<typeof SessionEventSchema>

/** Null for an unknown kind or a bad body, so one bad row never breaks the chat. */
export function parseEvent(row: unknown): SessionEvent | null {
  const parsed = SessionEventSchema.safeParse(row)
  return parsed.success ? parsed.data : null
}
