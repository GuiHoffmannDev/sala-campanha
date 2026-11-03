import type { SupabaseClient } from '@supabase/supabase-js'
import type { Provider } from '@sala/shared'
import { MODEL_CATALOG } from '@sala/shared/agent'

export const KEY_PROVIDERS = [...new Set(MODEL_CATALOG.map((model) => model.provider))]
export const PROVIDER_LABELS: Partial<Record<Provider, string>> = {
  anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini', fal: 'fal (Flux)',
}
export type KeyRow = { provider: Provider; last4: string; updated_at: string }

export async function loadKeys(client: SupabaseClient, teamId: string): Promise<KeyRow[]> {
  const { data, error } = await client.from('provider_keys').select('provider, last4, updated_at').eq('team_id', teamId)
  if (error) throw error
  return data as KeyRow[]
}

export async function saveKey(client: SupabaseClient, teamId: string, provider: Provider, key: string): Promise<void> {
  const { error } = await client.rpc('set_provider_key', { p_team: teamId, p_provider: provider, p_key: key })
  if (error) throw error
}

export async function deleteKey(client: SupabaseClient, teamId: string, provider: Provider): Promise<void> {
  const { error } = await client.rpc('delete_provider_key', { p_team: teamId, p_provider: provider })
  if (error) throw error
}

export const maskKey = (last4: string): string => `...${last4}`

/** Only provider names reach the composer; key material remains on the server. */
export async function loadKeyedProviders(client: SupabaseClient, teamId: string): Promise<Provider[]> {
  const { data, error } = await client.from('provider_keys').select('provider').eq('team_id', teamId)
  if (error) throw error
  return data.map((row) => row.provider as Provider)
}
