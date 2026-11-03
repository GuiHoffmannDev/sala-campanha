import type { SupabaseClient } from '@supabase/supabase-js'
import { UserFacingError } from './errors.ts'

const BUCKET = 'team-files'
const ONE_HOUR = 60 * 60

export const MAX_FILE_BYTES = 26_214_400
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function checkImageFile(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use uma imagem PNG, JPG ou WebP.'
  if (file.size > MAX_FILE_BYTES) return 'A imagem tem mais de 25 MB.'
  return null
}

export function newImagePath(teamId: string, folder: string, type: string): string {
  const extension = EXTENSIONS[type]
  if (!extension) throw new UserFacingError('Use uma imagem PNG, JPG ou WebP.')
  return `${teamId}/${folder}/${crypto.randomUUID()}.${extension}`.toLowerCase()
}

export async function uploadImage(client: SupabaseClient, path: string, file: Blob): Promise<void> {
  const { error } = await client.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
}

export async function downloadUrl(client: SupabaseClient, path: string, filename: string): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60, { download: filename })
  if (error) throw error
  return data.signedUrl
}

/** Signed URLs (valid for 1 h) for `team-files` paths, in one request. Paths that cannot be signed are left out. */
export async function signedUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ONE_HOUR)
  if (error) throw error
  const urls: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl
  return urls
}
