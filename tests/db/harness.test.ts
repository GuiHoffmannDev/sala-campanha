import { ROLES } from '../../packages/shared/src/domain'
import { createTestTeam } from '../helpers/supabase'

it('createTestTeam returns 4 signed-in members', async () => {
  const t = await createTestTeam()
  for (const role of ROLES) {
    const { data } = await t.members[role].client.auth.getUser()
    expect(data.user?.id).toBe(t.members[role].userId)
  }
})
