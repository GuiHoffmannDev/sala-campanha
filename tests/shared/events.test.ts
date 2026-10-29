import { EVENT_KINDS } from '../../packages/shared/src/domain.ts'
import { parseEvent } from '../../packages/shared/src/events.ts'

const columns = {
  id: 7,
  piece_id: '11111111-1111-4111-8111-111111111111',
  team_id: '22222222-2222-4222-8222-222222222222',
  author_id: '33333333-3333-4333-8333-333333333333',
  to_agent: false,
  mention_user_ids: [],
  delivery: 'not_applicable',
  created_at: '2026-10-28T12:00:00+00:00',
}

// One row per event kind, with the body fields the migrations write.
const rows = {
  user_message: {
    ...columns, kind: 'user_message', to_agent: true, delivery: 'queued',
    body: { text: 'Fundo mais claro', model: { text: { provider: 'anthropic', model: 'claude-opus-5-5' } }, reference_asset_ids: ['r1'] },
  },
  agent_started: {
    ...columns, kind: 'agent_started', author_id: null,
    body: { message_ids: [5], round: 1, models: { text: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }, image: null }, reference_count: 0, dropped_reference_ids: [] },
  },
  agent_result: {
    ...columns, kind: 'agent_result', author_id: null,
    body: { message_ids: [5], round: 1, version_id: 'v1', version_number: 1, image_prompt: null },
  },
  agent_error: {
    ...columns, kind: 'agent_error', author_id: null,
    body: { message_ids: [5], round: 1, code: 'timeout', message: 'fal não respondeu a tempo. Tente de novo.', image_prompt: 'banner' },
  },
  status_changed: { ...columns, kind: 'status_changed', body: { from: 'acabamento', to: 'gerando' } },
  version_added: { ...columns, kind: 'version_added', body: { version_id: 'v2', number: 2, phase: 'final' } },
  approval: { ...columns, kind: 'approval', body: { version_id: 'v1', from: 'base_em_revisao', to: 'acabamento' } },
  comment: { ...columns, kind: 'comment', body: { comment_id: 'c1', version_id: 'v1', parent_id: null } },
}

it('parses every event kind', () => {
  expect(Object.keys(rows).sort()).toEqual([...EVENT_KINDS].sort())
  for (const row of Object.values(rows)) expect(parseEvent(row)).toEqual(row)
  // A user message without a model choice stores model: null.
  const plain = { ...rows.user_message, body: { ...rows.user_message.body, model: null } }
  expect(parseEvent(plain)).toEqual(plain)
})

it('returns null for an unknown kind or a bad body', () => {
  expect(parseEvent({ ...columns, kind: 'video_added', body: {} })).toBeNull()
  expect(parseEvent({ ...rows.status_changed, body: { from: 'acabamento', to: 'publicada' } })).toBeNull()
  expect(parseEvent({ ...rows.comment, body: { comment_id: 'c1' } })).toBeNull()
  expect(parseEvent({ ...rows.agent_error, body: { ...rows.agent_error.body, code: 'nope' } })).toBeNull()
  expect(parseEvent(null)).toBeNull()
})
