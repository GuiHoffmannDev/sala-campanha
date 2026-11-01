import type { Membership } from '../../packages/desktop/src/data/team.ts'
import { pickWorkspace } from '../../packages/desktop/src/lib/workspace.ts'

const member = (teamId: string): Membership => ({ teamId, teamName: `Time ${teamId}`, role: 'designer', displayName: 'Ana' })

it('pickWorkspace keeps the stored workspace while the person is still a member', () => {
  expect(pickWorkspace([member('a'), member('b')], 'b')).toBe('b')
  expect(pickWorkspace([member('a'), member('b')], 'a')).toBe('a')
})

it('pickWorkspace falls back to the first workspace, or null without any', () => {
  // Removed from the stored workspace, or nothing stored yet.
  expect(pickWorkspace([member('a'), member('b')], 'c')).toBe('a')
  expect(pickWorkspace([member('a'), member('b')], null)).toBe('a')
  expect(pickWorkspace([], 'a')).toBeNull()
  expect(pickWorkspace([], null)).toBeNull()
})
