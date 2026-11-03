import type { SupabaseClient } from '@supabase/supabase-js'
import type { Provider } from '@sala/shared'

/** Only provider names reach the composer; key material remains on the server. */
export async function loadKeyedProviders(client: SupabaseClient, teamId: string): Promise<Provider[]> {
  const { data, error } = await client.from('provider_keys').select('provider').eq('team_id', teamId)
  if (error) throw error
  return data.map((row) => row.provider as Provider)
}
