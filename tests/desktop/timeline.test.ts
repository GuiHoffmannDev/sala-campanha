import type { SessionEvent } from '../../packages/shared/src/events.ts'
import type { Version } from '../../packages/desktop/src/data/versions.ts'
import { gapFillAfter, initials, mergeEvents, timelineItems } from '../../packages/desktop/src/lib/timeline.ts'

const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BIA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let nextId = 1
/** A parsed event with defaults; `kind` and `body` are given together so the union stays typed. */
function ev(e: Pick<SessionEvent, 'kind' | 'body'> & Partial<Omit<SessionEvent, 'kind' | 'body'>>): SessionEvent {
  return {
    id: nextId++, piece_id: 'p1', team_id: 't1', author_id: null, to_agent: false, mention_user_ids: [],
    delivery: 'not_applicable', created_at: '2026-11-01T12:00:00+00:00', ...e,
  } as SessionEvent
}

function version(id: string, number: number, origin: Version['origin'], phase: Version['phase'] = 'base'): Version {
  return {
    id, piece_id: 'p1', number, origin, phase, image_path: `t1/p1/${id}.png`, caption: `Legenda ${number}`,
    author_id: origin === 'agente' ? null : ANA, created_at: '2026-11-01T12:00:00+00:00',
  }
}

const versions = {
  v1: version('v1', 1, 'agente'),
  v2: version('v2', 2, 'upload', 'final'),
  v3: version('v3', 3, 'edicao', 'final'),
}
const ctx = { members: { [ANA]: 'Ana Souza', [BIA]: 'Bia' }, versions, me: ANA }

const message = (text: string, extra: Partial<SessionEvent> = {}) =>
  ev({ kind: 'user_message', body: { text, model: null, reference_asset_ids: [] }, ...extra })

const started = (models: { text: unknown; image: unknown }, dropped: string[] = []) =>
  ev({
    kind: 'agent_started',
    body: { message_ids: [1], round: 1, models, reference_count: dropped.length, dropped_reference_ids: dropped } as never,
  })

const textOf = (e: SessionEvent) => timelineItems([e], ctx).map((i) => i.text)

it('mergeEvents dedupes, keeps order and applies updates', () => {
  const a = message('a', { id: 10, delivery: 'queued', to_agent: true })
  const b = message('b', { id: 11 })
  const c = message('c', { id: 12 })
  const claimed = { ...a, delivery: 'claimed' } as SessionEvent

  const merged = mergeEvents([b, a], [c, claimed, b])
  expect(merged.map((e) => e.id)).toEqual([10, 11, 12])
  expect(merged[0]!.delivery).toBe('claimed')
  // The later copy wins, also inside one batch.
  expect(mergeEvents([], [a, claimed])[0]!.delivery).toBe('claimed')
  expect(mergeEvents([a], [])).toEqual([a])
})

it('timelineItems writes the exact text for each event kind', () => {
  // user_message: author, mine, delivery label only for messages to the agent.
  expect(timelineItems([message('Oi', { author_id: ANA, to_agent: true, delivery: 'queued' })], ctx)).toEqual([
    { type: 'message', id: expect.any(Number), author: 'Ana Souza', text: 'Oi', mine: true, deliveryLabel: 'na fila' },
  ])
  const labelOf = (delivery: SessionEvent['delivery'], to_agent = true) =>
    (timelineItems([message('x', { author_id: BIA, to_agent, delivery })], ctx)[0] as { deliveryLabel: string; mine: boolean })
  expect(labelOf('claimed').deliveryLabel).toBe('o agente está trabalhando')
  expect(labelOf('failed').deliveryLabel).toBe('falhou')
  expect(labelOf('done').deliveryLabel).toBe('')
  expect(labelOf('not_applicable', false).deliveryLabel).toBe('')
  expect(labelOf('not_applicable', false).mine).toBe(false)
  expect(timelineItems([message('x', { author_id: GONE })], ctx)[0]).toMatchObject({ author: 'Alguém', mine: false })
  expect(timelineItems([message('x', { author_id: null })], ctx)[0]).toMatchObject({ author: 'Alguém' })

  // agent_started: catalog labels, effort, dropped references.
  const opus = { provider: 'anthropic', model: 'claude-opus-5-5' }
  const banana = { provider: 'gemini', model: 'gemini-nano-banana-2.1' }
  expect(textOf(started({ text: opus, image: null }))).toEqual(['Gerando com Claude Opus 5.5.'])
  expect(textOf(started({ text: { ...opus, effort: 'xhigh' }, image: banana })))
    .toEqual(['Gerando com Claude Opus 5.5 (esforço muito alto) e Nano Banana 2.1.'])
  expect(textOf(started({ text: opus, image: { ...banana, effort: 'minimal' } }, ['r1'])))
    .toEqual(['Gerando com Claude Opus 5.5 e Nano Banana 2.1 (esforço mínimo). 1 referência ficou de fora pelo limite do modelo.'])
  expect(textOf(started({ text: opus, image: banana }, ['r1', 'r2', 'r3'])))
    .toEqual(['Gerando com Claude Opus 5.5 e Nano Banana 2.1. 3 referências ficaram de fora pelo limite do modelo.'])
  for (const [effort, label] of [['low', 'baixo'], ['medium', 'médio'], ['high', 'alto'], ['max', 'máximo']]) {
    expect(textOf(started({ text: { ...opus, effort }, image: null }))).toEqual([`Gerando com Claude Opus 5.5 (esforço ${label}).`])
  }
  expect(timelineItems([started({ text: opus, image: null })], ctx)[0]).toMatchObject({ type: 'system' })

  // agent_result and agent_error.
  const result = ev({
    kind: 'agent_result', body: { message_ids: [1], round: 1, version_id: 'v1', version_number: 1, image_prompt: 'um gato' },
  })
  expect(timelineItems([result], ctx)).toEqual([
    { type: 'agent', id: result.id, text: 'Versão 1', prompt: 'um gato', version: versions.v1, error: false },
  ])
  const unknownVersion = ev({
    kind: 'agent_result', body: { message_ids: [1], round: 1, version_id: 'v9', version_number: 9, image_prompt: null },
  })
  expect(timelineItems([unknownVersion], ctx)[0]).toMatchObject({ text: 'Versão 9', prompt: null, version: null })
  const failure = ev({
    kind: 'agent_error',
    body: { message_ids: [1], round: 1, code: 'provider_error', message: 'O provedor falhou.', image_prompt: 'um cão' },
  })
  expect(timelineItems([failure], ctx)).toEqual([
    { type: 'agent', id: failure.id, text: 'O provedor falhou.', prompt: 'um cão', version: null, error: true },
  ])

  // status_changed, by a person and by the agent.
  expect(textOf(ev({ kind: 'status_changed', author_id: BIA, body: { from: 'base_em_revisao', to: 'acabamento' } })))
    .toEqual(['Bia mudou a etapa de Base em revisão para Acabamento.'])
  expect(textOf(ev({ kind: 'status_changed', author_id: null, body: { from: 'gerando', to: 'base_em_revisao' } })))
    .toEqual(['O agente mudou a etapa de Gerando para Base em revisão.'])
  expect(textOf(ev({ kind: 'status_changed', author_id: GONE, body: { from: 'final_em_revisao', to: 'aprovada' } })))
    .toEqual(['Alguém mudou a etapa de Final em revisão para Aprovada.'])

  // approval and comment name the version number from the map.
  expect(textOf(ev({ kind: 'approval', author_id: ANA, body: { version_id: 'v2', from: 'final_em_revisao', to: 'aprovada' } })))
    .toEqual(['Ana Souza aprovou a versão 2.'])
  expect(textOf(ev({ kind: 'comment', author_id: BIA, body: { comment_id: 'c1', version_id: 'v1', parent_id: null } })))
    .toEqual(['Bia comentou na versão 1.'])

  // version_added: none for the agent, upload and caption edit by a person.
  expect(textOf(ev({ kind: 'version_added', author_id: null, body: { version_id: 'v1', number: 1, phase: 'base' } }))).toEqual([])
  expect(textOf(ev({ kind: 'version_added', author_id: ANA, body: { version_id: 'v2', number: 2, phase: 'final' } })))
    .toEqual(['Ana Souza enviou a versão final 2.'])
  expect(textOf(ev({ kind: 'version_added', author_id: BIA, body: { version_id: 'v3', number: 3, phase: 'final' } })))
    .toEqual(['Bia editou a legenda (versão 3).'])
})

it('timelineItems waits for a version it does not know yet', () => {
  // The version list reloads on its own live event; until then these items have nothing true to say.
  const none = { ...ctx, versions: {} }
  expect(timelineItems([ev({ kind: 'approval', author_id: ANA, body: { version_id: 'v2', from: 'final_em_revisao', to: 'aprovada' } })], none)).toEqual([])
  expect(timelineItems([ev({ kind: 'comment', author_id: ANA, body: { comment_id: 'c1', version_id: 'v1', parent_id: null } })], none)).toEqual([])
  expect(timelineItems([ev({ kind: 'version_added', author_id: ANA, body: { version_id: 'v2', number: 2, phase: 'final' } })], none)).toEqual([])
})

it('initials takes the first letters of the first and last names', () => {
  expect(initials('Ana Souza')).toBe('AS')
  expect(initials('  bia  ')).toBe('B')
  expect(initials('Maria da Silva Lima')).toBe('ML')
  expect(initials('Élio Ávila')).toBe('ÉÁ')
  expect(initials('')).toBe('?')
})

it('gapFillAfter starts before the oldest message still waiting on the agent', () => {
  expect(gapFillAfter([])).toBe(0)
  const done = message('a', { id: 20, to_agent: true, delivery: 'done' })
  const plain = message('b', { id: 21 })
  expect(gapFillAfter([done, plain])).toBe(21)
  // Delivery updates keep the id, so a queued or claimed message is read again with everything after it.
  const queued = message('c', { id: 22, to_agent: true, delivery: 'queued' })
  const claimed = message('d', { id: 23, to_agent: true, delivery: 'claimed' })
  expect(gapFillAfter([done, plain, queued, claimed, message('e', { id: 30 })])).toBe(21)
  expect(gapFillAfter([done, claimed])).toBe(22)
})
