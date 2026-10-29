/**
 * Reads the link Supabase sends back after Google or Apple sign-in:
 * `sala://auth/callback?sb_flow_id=...&code=...`, or an error in the query or
 * the fragment. `flowId` names the sign-in the code belongs to.
 * Any other link returns null and is left to the navigation.
 */
export function parseAuthCallback(url: string): { code: string; flowId?: string } | { error: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'sala:' || parsed.host !== 'auth' || !/^\/callback\/?$/.test(parsed.pathname)) return null

  const query = parsed.searchParams
  const fragment = new URLSearchParams(parsed.hash.slice(1))
  const read = (name: string) => query.get(name) || fragment.get(name)
  const code = read('code')
  const flowId = read('sb_flow_id')
  if (code) return flowId ? { code, flowId } : { code }
  const error = read('error_description') || read('error')
  return error ? { error } : null
}
