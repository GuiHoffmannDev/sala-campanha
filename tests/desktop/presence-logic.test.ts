import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { mentionNotice, onlineUsers, shouldNotify, usersInPiece } from '../../packages/desktop/src/lib/presence.ts'

const message: SessionEvent = {
  id: 1, team_id: 'team', piece_id: 'piece', author_id: 'ana', kind: 'user_message',
  body: { text: 'Veja esta versão', model: null, reference_asset_ids: [] },
  mention_user_ids: ['me'], to_agent: false, delivery: 'not_applicable', created_at: '2026-11-03T12:00:00Z',
}

it('onlineUsers and usersInPiece read the presence state', () => {
  const state = {
    ana: [{ user_id: 'ana', piece_id: 'one' }, { user_id: 'ana', piece_id: 'two' }],
    me: [{ user_id: 'me', piece_id: 'one' }, { user_id: 'me', piece_id: 'one' }],
    bob: [{ user_id: 'bob', piece_id: null }],
  }
  expect(onlineUsers(state)).toEqual(new Set(['ana', 'me', 'bob']))
  expect(usersInPiece(state, 'one')).toEqual(['ana', 'me'])
  expect(usersInPiece(state, 'two')).toEqual(['ana'])
  expect(usersInPiece({}, 'one')).toEqual([])
  expect(onlineUsers({})).toEqual(new Set())
})

it('notifies only mentions of me by someone else', () => {
  expect(shouldNotify(message, 'me')).toBe(true)
  expect(shouldNotify(message, 'ana')).toBe(false)
  expect(shouldNotify(message, 'other')).toBe(false)
  expect(shouldNotify({ ...message, author_id: 'me' }, 'me')).toBe(false)
  expect(shouldNotify({ ...message, kind: 'comment', body: { comment_id: 'c', version_id: 'v', parent_id: null } }, 'me')).toBe(false)
})

it('mentionNotice truncates long messages', () => {
  expect(mentionNotice(message, { ana: 'Ana Silva' }, 'Banner')).toEqual({
    title: 'Ana Silva mencionou você', body: 'Banner: Veja esta versão',
  })
  const long = { ...message, body: { ...message.body, text: '😀'.repeat(120) } }
  const notice = mentionNotice(long, { ana: 'Ana Silva' }, 'Banner')
  expect(notice.body).toBe(`Banner: ${'😀'.repeat(111)}…`)
  expect(Array.from(notice.body)).toHaveLength(120)
  expect(mentionNotice(message, {}, 'Banner').title).toBe('Alguém mencionou você')
})
