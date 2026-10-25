import { createTestTeam } from '../helpers/supabase'

it('member sees own team and not another team', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  const { data } = await a.members.designer.client.from('teams').select('id')
  expect(data?.map(r => r.id)).toEqual([a.teamId])
  const { data: other } = await a.members.admin.client.from('team_members').select('user_id').eq('team_id', b.teamId)
  expect(other).toEqual([])
})
it('authenticated cannot insert team_members', async () => {
  const a = await createTestTeam()
  const { error } = await a.members.admin.client.from('team_members')
    .insert({ team_id: a.teamId, user_id: a.members.admin.userId, role: 'admin', display_name: 'x' })
  expect(error?.code).toBe('42501')
})
