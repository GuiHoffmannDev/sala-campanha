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

/** What the app shows: a campaign, and optionally one of its pieces. */
export type Route = { campaignId: string | null; pieceId: string | null }

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const SHARE_LINK = new RegExp(`^sala://campanha/(${UUID})(?:/peca/(${UUID}))?/?$`)

/** `sala://campanha/<campaign_id>` or `sala://campanha/<campaign_id>/peca/<piece_id>`, lowercase. */
export function buildLink(route: { campaignId: string; pieceId?: string | null }): string {
  const campaign = `sala://campanha/${route.campaignId.toLowerCase()}`
  return route.pieceId ? `${campaign}/peca/${route.pieceId.toLowerCase()}` : campaign
}

/** The route of a share link, with lowercase ids. Any other text returns null. */
export function parseLink(url: string): Route | null {
  const match = SHARE_LINK.exec(url)
  if (!match) return null
  return { campaignId: match[1]!.toLowerCase(), pieceId: match[2]?.toLowerCase() ?? null }
}
