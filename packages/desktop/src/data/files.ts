import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'team-files'
const ONE_HOUR = 60 * 60

/** Signed URLs (valid for 1 h) for `team-files` paths, in one request. Paths that cannot be signed are left out. */
export async function signedUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ONE_HOUR)
  if (error) throw error
  const urls: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl
  return urls
}
