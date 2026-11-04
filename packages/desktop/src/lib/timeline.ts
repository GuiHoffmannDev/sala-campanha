import { findModel, type ModelCapability, type ModelRef } from '@sala/shared/agent'
import type { SessionEvent } from '@sala/shared/events'
import type { Version } from '../data/versions.ts'
import { DELIVERY_LABELS, EFFORT_LABELS, STATUS_LABELS } from './labels.ts'

export type TimelineItem =
  | { type: 'message'; id: number; author: string; text: string; mine: boolean; deliveryLabel: string }
  | { type: 'agent'; id: number; text: string; prompt: string | null; version: Version | null; error: boolean }
  | { type: 'system'; id: number; text: string; version?: Version }

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

// Ids are taken at insert but rows show up at commit, so a lower id can appear after a higher one.
// shortcut: assumes a writer's transaction lasts under 30 s; track commit order (e.g. a commit sequence) if longer ones appear.
const GAP_LOOKBACK_MS = 30_000

// Postgres timestamptz text (`T` or space, any fraction, `Z`, `±HH` or `±HH:MM`).
const DB_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/

/** Milliseconds of a DB timestamp, or NaN. Rewritten as strict ISO first: WKWebView's Date.parse is stricter than V8's. */
function dbTimeMs(value: string): number {
  const m = DB_TIME.exec(value)
  if (!m) return NaN
  const [, date, time, fraction = '', zone = ''] = m
  const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.length > 3 ? zone.slice(-2) : '00'}`
  return Date.parse(`${date}T${time}.${fraction.padEnd(3, '0').slice(0, 3)}${offset}`)
}

/**
 * The `since` to load after a (re)join: the latest `created_at` seen minus the lookback. Undefined when no
 * time can be read, so the fill falls back to the id cursor.
 */
export function gapFillSince(events: SessionEvent[]): string | undefined {
  const times = events.map((e) => dbTimeMs(e.created_at)).filter((t) => !Number.isNaN(t))
  if (!times.length) return undefined
  return new Date(times.reduce((a, b) => Math.max(a, b)) - GAP_LOOKBACK_MS).toISOString()
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
  return ref.effort ? `${label} (effort ${EFFORT_LABELS[ref.effort] ?? ref.effort})` : label
}

function startedText(body: Extract<SessionEvent, { kind: 'agent_started' }>['body']): string {
  const { text, image } = body.models
  const models = [text && modelLabel(text, 'text'), image && modelLabel(image, 'image')].filter(Boolean)
  let out = `Generating with ${models.join(' and ')}.`
  const dropped = body.dropped_reference_ids.length
  if (dropped === 1) out += ' 1 reference was left out due to the model limit.'
  else if (dropped > 1) out += ` ${dropped} references were left out due to the model limit.`
  return out
}

/** Uses the stable error code so historical server copy follows the app's language too. */
function agentErrorText(code: Extract<SessionEvent, { kind: 'agent_error' }>['body']['code']): string {
  switch (code) {
    case 'missing_key': return 'A provider key is missing. Ask your workspace admin to add it.'
    case 'invalid_model': return 'The selected model or effort is not available. Choose another option.'
    case 'wrong_status': return 'This piece cannot generate base versions at its current stage. Go back one stage to generate again.'
    case 'provider_error': return 'The provider rejected the request. Check your provider account and try again.'
    case 'timeout': return 'The provider did not respond in time. Try again.'
    case 'invalid_output': return 'The provider returned a response the agent could not understand. Try again.'
    case 'internal': return 'Internal agent error. Try again.'
  }
}

/** What the chat shows for each event, in the order given. */
export function timelineItems(events: SessionEvent[], ctx: TimelineContext): TimelineItem[] {
  const person = (id: string | null) => (id && ctx.members[id]) || 'Someone'
  const items: TimelineItem[] = []
  const system = (id: number, text: string, version?: Version) => items.push({ type: 'system', id, text, ...(version && { version }) })

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
          type: 'agent', id: e.id, text: `Version ${e.body.version_number}`, prompt: e.body.image_prompt,
          version: ctx.versions[e.body.version_id] ?? null, error: false,
        })
        break
      case 'agent_error':
        items.push({ type: 'agent', id: e.id, text: agentErrorText(e.body.code), prompt: e.body.image_prompt, version: null, error: true })
        break
      case 'status_changed': {
        const who = e.author_id ? person(e.author_id) : 'The agent'
        system(e.id, `${who} changed the stage from ${STATUS_LABELS[e.body.from]} to ${STATUS_LABELS[e.body.to]}.`)
        break
      }
      // The next three name a version. One not loaded yet shows up when the version list reloads.
      case 'approval': {
        const v = ctx.versions[e.body.version_id]
        if (v) system(e.id, `${person(e.author_id)} approved version ${v.number}.`, v)
        break
      }
      case 'version_added': {
        // The agent's versions are already shown by their agent_result.
        const v = ctx.versions[e.body.version_id]
        if (!e.author_id || !v) break
        if (v.origin === 'upload') system(e.id, `${person(e.author_id)} uploaded final version ${v.number}.`, v)
        else if (v.origin === 'edicao') system(e.id, `${person(e.author_id)} edited the caption (version ${v.number}).`, v)
        break
      }
      case 'comment': {
        const v = ctx.versions[e.body.version_id]
        if (v) system(e.id, `${person(e.author_id)} commented on version ${v.number}.`, v)
        break
      }
    }
  }
  return items
}
