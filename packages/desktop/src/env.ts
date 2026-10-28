/** Reads the Supabase settings the app needs. Only the anon key is allowed here, never the service role. */
export function readEnv(env: Record<string, string | undefined>): { supabaseUrl: string; anonKey: string } {
  const supabaseUrl = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em packages/desktop/.env.local (veja supabase status).',
    )
  }
  return { supabaseUrl, anonKey }
}
