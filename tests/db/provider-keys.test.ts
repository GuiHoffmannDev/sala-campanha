import { createTestTeam, dbQuery, serviceClient } from '../helpers/supabase'

const KEY = 'sk-test-1234567890abcd'

async function secretIdOf(teamId: string, provider: string): Promise<string> {
  const { data, error } = await serviceClient().from('provider_keys').select('vault_secret_id').eq('team_id', teamId).eq('provider', provider).single()
  if (error || !data) throw new Error(`provider_keys row not found: ${error?.message}`)
  return data.vault_secret_id
}

async function vaultHasSecret(secretId: string): Promise<boolean> {
  return (await dbQuery('select 1 from vault.secrets where id = $1', [secretId])).length === 1
}

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

  const { error: setError } = await b.members.admin.client.rpc('set_provider_key', { p_team: a.teamId, p_provider: 'openai', p_key: 'sk-other-team-key-0000' })
  expect(setError).not.toBeNull()
  const { error: deleteError } = await b.members.admin.client.rpc('delete_provider_key', { p_team: a.teamId, p_provider: 'openai' })
  expect(deleteError).not.toBeNull()

  const { data } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: a.teamId, p_provider: 'openai' })
  expect(data).toBe(KEY)
})

it('rejects key shorter than 20 characters', async () => {
  const t = await createTestTeam()
  const { error } = await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: 'sk-' + 'x'.repeat(16) })
  expect(error).not.toBeNull()
  // Positive control: exactly 20 characters is accepted, so the rejection above is about length.
  expect((await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: 'sk-' + 'x'.repeat(17) })).error).toBeNull()
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
  expect((await admin.from('provider_keys').select('updated_by')).error).not.toBeNull()

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
  const secretId = await secretIdOf(t.teamId, 'gemini')

  expect((await t.members.gestor.client.rpc('delete_provider_key', { p_team: t.teamId, p_provider: 'gemini' })).error).not.toBeNull()
  expect((await admin.rpc('delete_provider_key', { p_team: t.teamId, p_provider: 'gemini' })).error).toBeNull()

  const { data } = await admin.from('provider_keys').select('provider')
  expect(data).toEqual([])
  const { data: plain, error } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'gemini' })
  expect(error).toBeNull()
  expect(plain).toBeNull()
  expect(await vaultHasSecret(secretId)).toBe(false)
})

it('deleting the team removes its Vault secrets', async () => {
  const t = await createTestTeam()
  await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: KEY })
  const secretId = await secretIdOf(t.teamId, 'openai')
  expect(await vaultHasSecret(secretId)).toBe(true)

  expect((await serviceClient().from('teams').delete().eq('id', t.teamId)).error).toBeNull()
  expect(await vaultHasSecret(secretId)).toBe(false)
})

it('set_provider_key recreates a secret removed outside the RPCs', async () => {
  const t = await createTestTeam()
  const admin = t.members.admin.client
  await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'anthropic', p_key: KEY })
  await dbQuery('delete from vault.secrets where id = $1', [await secretIdOf(t.teamId, 'anthropic')])

  const newKey = 'sk-ant-replacement-key-0000'
  expect((await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'anthropic', p_key: newKey })).error).toBeNull()
  expect(await vaultHasSecret(await secretIdOf(t.teamId, 'anthropic'))).toBe(true)
  const { data: plain } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'anthropic' })
  expect(plain).toBe(newKey)
})

it('deleting the admin who set a key keeps the key', async () => {
  const t = await createTestTeam()
  await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: KEY })

  expect((await serviceClient().auth.admin.deleteUser(t.members.admin.userId)).error).toBeNull()

  const { data } = await serviceClient().from('provider_keys').select('updated_by,last4').eq('team_id', t.teamId)
  expect(data).toEqual([{ updated_by: null, last4: 'abcd' }])
  const { data: plain } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'openai' })
  expect(plain).toBe(KEY)
})

it('Postgres does not log statement text with keys', async () => {
  // `all` or `mod` would write set_provider_key calls, plaintext key included, to the log.
  const [row] = await dbQuery<{ log_statement: string }>('show log_statement')
  expect(['none', 'ddl']).toContain(row?.log_statement)
})

it('a pasted key is trimmed; a key with inner spaces is rejected', async () => {
  const t = await createTestTeam()
  const admin = t.members.admin.client
  expect((await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: `  ${KEY}\n` })).error).toBeNull()
  const { data: plain } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'openai' })
  expect(plain).toBe(KEY)
  const { data } = await t.members.designer.client.from('provider_keys').select('last4')
  expect(data).toEqual([{ last4: 'abcd' }])

  const inner = await admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: 'sk-test-1234 567890abcd' })
  expect(inner.error?.code).toBe('22023')
  const { data: kept } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'openai' })
  expect(kept).toBe(KEY)
})

it('two concurrent first saves both succeed and leave one secret', async () => {
  const t = await createTestTeam()
  const admin = t.members.admin.client
  const keys = ['sk-concurrent-key-one-1111', 'sk-concurrent-key-two-2222']
  const results = await Promise.all(keys.map((p_key) => admin.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'fal', p_key })))
  for (const r of results) expect(r.error).toBeNull()

  const { data: plain } = await serviceClient().rpc('get_provider_key_for_executor', { p_team: t.teamId, p_provider: 'fal' })
  expect(keys).toContain(plain)
  const secrets = await dbQuery('select 1 from vault.decrypted_secrets where decrypted_secret = any($1)', [keys])
  expect(secrets).toHaveLength(1)
})
