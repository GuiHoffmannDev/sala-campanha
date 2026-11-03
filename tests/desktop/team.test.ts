import { inviteMember, loadInvites, loadMembers, removeMember, revokeInvite, setMemberRole } from '../../packages/desktop/src/data/team.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { createTestTeam } from '../helpers/supabase.ts'

it('only the admin invites, with the friendly message', async () => {
  const t = await createTestTeam()
  const error = await inviteMember(t.members.gestor.client, t.teamId, 'new@test.local', 'designer').catch((e: unknown) => e)
  expect(friendlyError(error)).toBe('Só o admin do workspace convida pessoas.')
  expect(await loadInvites(t.members.admin.client, t.teamId)).toEqual([])
})

it('admin invites, lists and cancels an invite', async () => {
  const t = await createTestTeam()
  const client = t.members.admin.client
  await inviteMember(client, t.teamId, ' New@Test.Local ', 'designer')
  expect(await loadInvites(client, t.teamId)).toEqual([
    { email: 'new@test.local', role: 'designer', created_at: expect.any(String) },
  ])
  await revokeInvite(client, t.teamId, 'new@test.local')
  expect(await loadInvites(client, t.teamId)).toEqual([])
})

it('admin changes a role and removes a member', async () => {
  const t = await createTestTeam()
  const client = t.members.admin.client
  await setMemberRole(client, t.teamId, t.members.designer.userId, 'gestor')
  expect((await loadMembers(client, t.teamId)).find((m) => m.userId === t.members.designer.userId)?.role).toBe('gestor')
  await removeMember(client, t.teamId, t.members.designer.userId)
  expect((await loadMembers(client, t.teamId)).some((m) => m.userId === t.members.designer.userId)).toBe(false)
  expect(await loadMembers(t.members.designer.client, t.teamId)).toEqual([])
})
