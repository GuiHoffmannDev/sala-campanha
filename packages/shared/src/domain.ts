import { z } from 'zod'

// Exact values from the spec's Global Constraints. The Postgres enums must match these.

export const ROLES = ['admin', 'gestor', 'designer', 'espectador'] as const
export const RoleSchema = z.enum(ROLES)
export type Role = z.infer<typeof RoleSchema>

// Ordered: each status is one step after the previous one.
export const PIECE_STATUSES = ['gerando', 'base_em_revisao', 'acabamento', 'final_em_revisao', 'aprovada'] as const
export const PieceStatusSchema = z.enum(PIECE_STATUSES)
export type PieceStatus = z.infer<typeof PieceStatusSchema>

export const PIECE_KINDS = ['imagem', 'texto', 'imagem_texto'] as const
export const PieceKindSchema = z.enum(PIECE_KINDS)
export type PieceKind = z.infer<typeof PieceKindSchema>

// agente: agent result; upload: final made outside the app; edicao: caption edit by a person.
export const VERSION_ORIGINS = ['agente', 'upload', 'edicao'] as const
export const VersionOriginSchema = z.enum(VERSION_ORIGINS)
export type VersionOrigin = z.infer<typeof VersionOriginSchema>

export const VERSION_PHASES = ['base', 'final'] as const
export const VersionPhaseSchema = z.enum(VERSION_PHASES)
export type VersionPhase = z.infer<typeof VersionPhaseSchema>

// Caption excerpt offsets (comments.text_start/text_end) count Unicode code
// points, as Postgres does, not UTF-16 units: compute them on
// Array.from(caption), never with caption.length or String.slice.

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'fal', 'krea'] as const
export const ProviderSchema = z.enum(PROVIDERS)
export type Provider = z.infer<typeof ProviderSchema>

export const EVENT_KINDS = [
  'user_message',
  'agent_started',
  'agent_result',
  'agent_error',
  'status_changed',
  'version_added',
  'approval',
  'comment',
] as const
export const EventKindSchema = z.enum(EVENT_KINDS)
export type EventKind = z.infer<typeof EventKindSchema>

export const DELIVERY_STATUSES = ['queued', 'claimed', 'done', 'failed', 'not_applicable'] as const
export const DeliveryStatusSchema = z.enum(DELIVERY_STATUSES)
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>
