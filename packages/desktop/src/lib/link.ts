/**
 * Reads the link Supabase sends back after Google or Apple sign-in:
 * `sala://auth/callback?code=...`, or an error in the query or the fragment.
 * Any other link returns null and is left to the navigation.
 */
export function parseAuthCallback(url: string): { code: string } | { error: string } | null {
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
  if (code) return { code }
  const error = read('error_description') || read('error')
  return error ? { error } : null
}
