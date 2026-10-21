import { z } from 'zod'

// Exact values from the spec's Global Constraints. The Postgres enums must match these.

export const ROLES = ['admin', 'gestor', 'designer', 'espectador'] as const
export const RoleSchema = z.enum(ROLES)
export type Role = z.infer<typeof RoleSchema>

// Ordered: each status is one step after the previous one.
export const PIECE_STATUSES = ['gerando', 'base_em_revisao', 'acabamento', 'final_em_revisao', 'aprovada'] as const
export const PieceStatusSchema = z.enum(PIECE_STATUSES)
export type PieceStatus = z.infer<typeof PieceStatusSchema>

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
] as const
export const EventKindSchema = z.enum(EVENT_KINDS)
export type EventKind = z.infer<typeof EventKindSchema>

export const DELIVERY_STATUSES = ['queued', 'claimed', 'done', 'failed', 'not_applicable'] as const
export const DeliveryStatusSchema = z.enum(DELIVERY_STATUSES)
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>
