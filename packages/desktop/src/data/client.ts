import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The app's Supabase client: anon key only, PKCE for Google and Apple, and the
 * session kept in localStorage (the default). The callback link is handled by
 * the app itself, so the client does not look for a session in the page URL.
 *
 * Every sign-in started (Google, Apple and also the email code) stores its own
 * PKCE verifier. `appendPkceFlowIdToRedirects` puts the id of the sign-in in
 * the callback link (`sb_flow_id`), so finishing one sign-in uses its own
 * verifier, not the one of whichever sign-in started last.
 */
export function createAppClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, experimental: { appendPkceFlowIdToRedirects: true } },
  })
}
