import { createTestTeam, serviceClient } from '../helpers/supabase'

const KEY = 'sk-test-1234567890abcd'

it('admin sets key; members see only last4', async () => {
  const t = await createTestTeam()
  const key = KEY
  expect((await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: key })).error).toBeNull()
  const { data } = await t.members.designer.client.from('provider_keys').select('provider,last4')
  expect(data).toEqual([{ provider: 'openai', last4: 'abcd' }])
})

it('gestor cannot set key', async () => {
  const t = await createTestTeam()
  const { error } = await t.members.gestor.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: KEY })
  expect(error).not.toBeNull()
  const { data } = await t.members.admin.client.from('provider_keys').select('provider')
  expect(data).toEqual([])
})

it('admin of another team cannot set or delete key', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  await a.members.admin.client.rpc('set_provider_key', { p_team: a.teamId, p_provider: 'openai', p_key: KEY })

  const { error: setError } = await b.members.admin.client.rpc('set_provider_key', { p_team: a.teamId, p_provider: 'openai', p_key: 'sk-other-team-key' })
  expect(setError).not.toBeNull()
  const { error: deleteError } = await b.members.admin.client.rpc('delete_provider_key', { p_team: a.teamId, p_provider: 'openai' })
  expect(deleteError).not.toBeNull()

  const { data } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: a.teamId, p_provider: 'openai' })
  expect(data).toBe(KEY)
})

it('rejects key shorter than 8 characters', async () => {
  const t = await createTestTeam()
  const { error } = await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: 'sk-1234' })
  expect(error).not.toBeNull()
  // Positive control: exactly 8 characters is accepted, so the rejection above is about length.
  expect((await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: 'sk-12345' })).error).toBeNull()
})

it('never returns plaintext to members', async () => {
  const t = await createTestTeam()
  const admin = t.members.admin.client
  const set = await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'anthropic', p_key: KEY })
  expect(set.error).toBeNull()
  expect(JSON.stringify(set)).not.toContain(KEY)

  // `vault_secret_id` is revoked at column level, so `*` and that column are denied outright.
  const all = await admin.from('provider_keys').select('*')
  expect(all.error).not.toBeNull()
  expect(JSON.stringify(all)).not.toContain(KEY)
  expect((await admin.from('provider_keys').select('vault_secret_id')).error).not.toBeNull()

  const visible = await admin.from('provider_keys').select('team_id,provider,last4,updated_at')
  expect(visible.error).toBeNull()
  expect(visible.data).toHaveLength(1)
  expect(JSON.stringify(visible)).not.toContain(KEY)

  const executor = await admin.rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'anthropic' })
  expect(executor.error).not.toBeNull()
  expect(JSON.stringify(executor)).not.toContain(KEY)
})

it('service role reads plaintext for executor', async () => {
  const t = await createTestTeam()
  await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'krea', p_key: KEY })
  const { data, error } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'krea' })
  expect(error).toBeNull()
  expect(data).toBe(KEY)
})

it('admin replaces key; last4 and plaintext follow the new key', async () => {
  const t = await createTestTeam()
  const admin = t.members.admin.client
  await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'fal', p_key: KEY })
  const newKey = 'fal-new-key-9999wxyz'
  expect((await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'fal', p_key: newKey })).error).toBeNull()

  const { data } = await admin.from('provider_keys').select('provider,last4')
  expect(data).toEqual([{ provider: 'fal', last4: 'wxyz' }])
  const { data: plain } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'fal' })
  expect(plain).toBe(newKey)
})

it('admin deletes key; executor gets nothing', async () => {
  const t = await createTestTeam()
  const admin = t.members.admin.client
  await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'gemini', p_key: KEY })

  expect((await t.members.gestor.client.rpc('delete_provider_key', { p_team: t.teamId, p_provider: 'gemini' })).error).not.toBeNull()
  expect((await admin.rpc('delete_provider_key', { p_team: t.teamId, p_provider: 'gemini' })).error).toBeNull()

  const { data } = await admin.from('provider_keys').select('provider')
  expect(data).toEqual([])
  const { data: plain, error } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'gemini' })
  expect(error).toBeNull()
  expect(plain).toBeNull()
})
