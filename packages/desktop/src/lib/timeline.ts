import { findModel, type ModelCapability, type ModelRef } from '@sala/shared/agent'
import type { SessionEvent } from '@sala/shared/events'
import type { Version } from '../data/versions.ts'
import { DELIVERY_LABELS, EFFORT_LABELS, STATUS_LABELS } from './labels.ts'

export type TimelineItem =
  | { type: 'message'; id: number; author: string; text: string; mine: boolean; deliveryLabel: string }
  | { type: 'agent'; id: number; text: string; prompt: string | null; version: Version | null; error: boolean }
  | { type: 'system'; id: number; text: string }

export type TimelineContext = {
  /** Display name by user id. */
  members: Record<string, string>
  /** The piece's versions by id. */
  versions: Record<string, Version>
  /** The signed-in person's user id. */
  me: string
}

/** Events by id, oldest first. A copy that arrives later replaces the earlier one (a delivery update). */
export function mergeEvents(current: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  const byId = new Map(current.map((e) => [e.id, e]))
  for (const e of incoming) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/**
 * The `afterId` to load after a (re)join: the last event seen, or just before the oldest message
 * still queued or claimed, because a delivery update keeps the row's id and a gap can hide it.
 */
export function gapFillAfter(events: SessionEvent[]): number {
  const pending = events.find((e) => e.to_agent && (e.delivery === 'queued' || e.delivery === 'claimed'))
  return pending ? pending.id - 1 : (events.at(-1)?.id ?? 0)
}

/** Up to two letters for an avatar: the first and last names' first letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const first = Array.from(words[0]!)[0]!
  const last = words.length > 1 ? Array.from(words[words.length - 1]!)[0]! : ''
  return (first + last).toUpperCase()
}

function modelLabel(ref: ModelRef, capability: ModelCapability): string {
  const label = findModel(ref, capability)?.label ?? ref.model
  return ref.effort ? `${label} (esforço ${EFFORT_LABELS[ref.effort] ?? ref.effort})` : label
}

function startedText(body: Extract<SessionEvent, { kind: 'agent_started' }>['body']): string {
  const { text, image } = body.models
  const models = [text && modelLabel(text, 'text'), image && modelLabel(image, 'image')].filter(Boolean)
  let out = `Gerando com ${models.join(' e ')}.`
  const dropped = body.dropped_reference_ids.length
  if (dropped === 1) out += ' 1 referência ficou de fora pelo limite do modelo.'
  else if (dropped > 1) out += ` ${dropped} referências ficaram de fora pelo limite do modelo.`
  return out
}

/** What the chat shows for each event, in the order given. */
export function timelineItems(events: SessionEvent[], ctx: TimelineContext): TimelineItem[] {
  const person = (id: string | null) => (id && ctx.members[id]) || 'Alguém'
  const items: TimelineItem[] = []
  const system = (id: number, text: string) => items.push({ type: 'system', id, text })

  for (const e of events) {
    switch (e.kind) {
      case 'user_message':
        items.push({
          type: 'message', id: e.id, author: person(e.author_id), text: e.body.text, mine: e.author_id === ctx.me,
          deliveryLabel: e.to_agent ? DELIVERY_LABELS[e.delivery] : '',
        })
        break
      case 'agent_started':
        system(e.id, startedText(e.body))
        break
      case 'agent_result':
        items.push({
          type: 'agent', id: e.id, text: `Versão ${e.body.version_number}`, prompt: e.body.image_prompt,
          version: ctx.versions[e.body.version_id] ?? null, error: false,
        })
        break
      case 'agent_error':
        items.push({ type: 'agent', id: e.id, text: e.body.message, prompt: e.body.image_prompt, version: null, error: true })
        break
      case 'status_changed': {
        const who = e.author_id ? person(e.author_id) : 'O agente'
        system(e.id, `${who} mudou a etapa de ${STATUS_LABELS[e.body.from]} para ${STATUS_LABELS[e.body.to]}.`)
        break
      }
      // The next three name a version. One not loaded yet shows up when the version list reloads.
      case 'approval': {
        const v = ctx.versions[e.body.version_id]
        if (v) system(e.id, `${person(e.author_id)} aprovou a versão ${v.number}.`)
        break
      }
      case 'version_added': {
        // The agent's versions are already shown by their agent_result.
        const v = ctx.versions[e.body.version_id]
        if (!e.author_id || !v) break
        if (v.origin === 'upload') system(e.id, `${person(e.author_id)} enviou a versão final ${v.number}.`)
        else if (v.origin === 'edicao') system(e.id, `${person(e.author_id)} editou a legenda (versão ${v.number}).`)
        break
      }
      case 'comment': {
        const v = ctx.versions[e.body.version_id]
        if (v) system(e.id, `${person(e.author_id)} comentou na versão ${v.number}.`)
        break
      }
    }
  }
  return items
}
