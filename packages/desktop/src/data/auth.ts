import { isAuthRetryableFetchError, type SupabaseClient, type User } from '@supabase/supabase-js'
import { UserFacingError } from './errors.ts'

export type OAuthProvider = 'google' | 'apple'

const CALLBACK = 'sala://auth/callback'

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** Emails a 6-digit code. A new email gets an account, so sign-up and sign-in are the same step. */
export async function sendLoginCode(client: SupabaseClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: true } })
  if (!error) return
  if (error.status === 429) throw new UserFacingError('Espere um minuto antes de pedir outro código.')
  throw error
}

export async function verifyLoginCode(client: SupabaseClient, email: string, code: string): Promise<void> {
  const { error } = await client.auth.verifyOtp({ email: normalizeEmail(email), token: code.trim(), type: 'email' })
  // A network failure keeps its own message; any answer from the server means the code did not work.
  if (error) throw isAuthRetryableFetchError(error) ? error : new UserFacingError('Código inválido ou vencido. Peça um novo.')
}

/** The Supabase URL that starts Google or Apple sign-in in the browser and comes back to `sala://auth/callback`. */
export async function oauthUrl(client: SupabaseClient, provider: OAuthProvider): Promise<string> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
  })
  if (error) throw error
  // supabase-js only builds the URL. Asking the server first shows a provider
  // that is off as a message in the app, not as an error page in the browser.
  const response = await fetch(data.url, { redirect: 'manual' })
  if (response.status >= 400) {
    const body = (await response.json().catch(() => null)) as { msg?: unknown } | null
    throw new Error(typeof body?.msg === 'string' ? body.msg : `authorize failed with HTTP ${response.status}`)
  }
  await response.body?.cancel()
  return data.url
}

/**
 * Trades the code from `sala://auth/callback` for a session (PKCE), with the
 * verifier of the sign-in named by `flowId` (the link's `sb_flow_id`).
 */
export async function finishOAuth(client: SupabaseClient, code: string, flowId?: string): Promise<void> {
  const { error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
  if (error) throw isAuthRetryableFetchError(error) ? error : new UserFacingError('Não foi possível entrar. Tente de novo.')
}

export async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut()
  if (error) throw error
}

/** The name the person chose, or else the one Google or Apple sent; null when there is none. */
export function displayNameOf(user: User): string | null {
  const metadata: Record<string, unknown> = user.user_metadata ?? {}
  for (const key of ['display_name', 'full_name', 'name']) {
    const value = metadata[key]
    // The server takes at most 80 characters (code points); Google and Apple send names of any length.
    if (typeof value === 'string' && value.trim()) return Array.from(value.trim()).slice(0, 80).join('').trim()
  }
  return null
}

export async function saveDisplayName(client: SupabaseClient, name: string): Promise<void> {
  const { error } = await client.auth.updateUser({ data: { display_name: name.trim() } })
  if (error) throw error
}
