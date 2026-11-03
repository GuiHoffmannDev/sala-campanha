import { KEY_PROVIDERS, deleteKey, loadKeys, maskKey, saveKey } from '../../packages/desktop/src/data/keys.ts'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { createTestTeam } from '../helpers/supabase.ts'

it('admin saves a key and members load only the mask', async () => {
  const t = await createTestTeam()
  const key = 'local-test-key-with-secret-1234'
  await saveKey(t.members.admin.client, t.teamId, 'anthropic', key)
  const rows = await loadKeys(t.members.designer.client, t.teamId)
  expect(rows).toEqual([{ provider: 'anthropic', last4: '1234', updated_at: expect.any(String) }])
  expect(JSON.stringify(rows)).not.toContain(key)
  expect(maskKey(rows[0]!.last4)).toBe('...1234')
  expect(KEY_PROVIDERS).toEqual(['anthropic', 'openai', 'gemini', 'fal'])
  await deleteKey(t.members.admin.client, t.teamId, 'anthropic')
  expect(await loadKeys(t.members.admin.client, t.teamId)).toEqual([])
})

it('gestor gets the friendly admin-only message', async () => {
  const t = await createTestTeam()
  for (const action of [
    () => saveKey(t.members.gestor.client, t.teamId, 'openai', 'local-fake-provider-key-0001'),
    () => deleteKey(t.members.gestor.client, t.teamId, 'openai'),
  ]) {
    expect(friendlyError(await action().catch((e: unknown) => e))).toBe('Só o admin do workspace gerencia as chaves.')
  }
})
