import { mentionedIn, mentionQuery, messageTarget } from '../../packages/desktop/src/lib/routing.ts'
import { loadEvents, postMessage } from '../../packages/desktop/src/data/events.ts'
import { createPieceFixture } from '../helpers/supabase'

const ana = { userId: 'ana', name: 'Ana' }
const bia = { userId: 'bia', name: 'Bia' }
const caio = { userId: 'caio', name: 'Caio' }
const cases = [
  { text: 'Olá', mentions: [], toAgent: true },
  { text: '@Ana oi', mentions: [ana], toAgent: false },
  { text: '@algo', mentions: [], toAgent: true },
  { text: '  @Ana oi', mentions: [ana], toAgent: false },
  { text: 'Oi @Ana', mentions: [ana], toAgent: true },
  { text: '\u00a0\u200b@Ana oi', mentions: [ana], toAgent: false },
]

it('messageTarget mirrors the SQL routing rule', () => {
  for (const { text, mentions, toAgent } of cases) {
    expect(messageTarget(text, mentions)).toEqual({ toAgent, label: toAgent ? 'Para o agente' : 'Para @Ana' })
  }
})

it('lists several people in the label', () => {
  expect(messageTarget('@Ana @Bia oi', [ana, bia]).label).toBe('Para @Ana e @Bia')
  expect(messageTarget('@Ana @Bia @Caio oi', [ana, bia, caio]).label).toBe('Para @Ana, @Bia e @Caio')
})

it('matches longer names first, once per person, without matching name prefixes', () => {
  const souza = { userId: 'souza', name: 'Ana Souza' }
  expect(mentionedIn('@Ana Souza, @Bia e @Ana. @Ana @Anabela', [ana, souza, bia])).toEqual([souza, bia, ana])
  expect(mentionedIn('@Anabela', [ana])).toEqual([])
  expect(mentionedIn('Olá', [])).toEqual([])
})

it('mentionQuery uses the caret and rejects multiline or long queries', () => {
  expect(mentionQuery('Oi @An depois', 6)).toBe('An')
  expect(mentionQuery('@Ana @', 6)).toBe('')
  expect(mentionQuery('Olá', 3)).toBeNull()
  expect(mentionQuery('@Ana\noi', 7)).toBeNull()
  expect(mentionQuery('@Ana\roi', 7)).toBeNull()
  expect(mentionQuery(`@${'a'.repeat(30)}`, 31)).toBe('a'.repeat(30))
  expect(mentionQuery(`@${'a'.repeat(31)}`, 32)).toBeNull()
})

it('post_message routes the same way as messageTarget', async () => {
  const f = await createPieceFixture()
  const client = f.t.members.gestor.client
  const member = { userId: f.t.members.designer.userId, name: 'Ana' }
  for (const { text, mentions, toAgent } of cases) {
    const found = mentions.length ? [member] : []
    await postMessage(client, {
      pieceId: f.pieceId, text, mentionUserIds: found.map((m) => m.userId), model: null, referenceAssetIds: [],
    })
    const event = (await loadEvents(client, f.pieceId)).at(-1)!
    expect(event.to_agent).toBe(toAgent)
    expect(event.to_agent).toBe(messageTarget(text, found).toAgent)
    expect(event.delivery).toBe(toAgent ? 'queued' : 'not_applicable')
  }
})

it('postMessage propagates a write denied by RLS', async () => {
  const f = await createPieceFixture()
  await expect(postMessage(f.t.members.espectador.client, {
    pieceId: f.pieceId, text: 'Olá', mentionUserIds: [], model: null, referenceAssetIds: [],
  })).rejects.toMatchObject({ code: '42501' })
})
