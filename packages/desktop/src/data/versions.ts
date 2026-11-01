import type { SupabaseClient } from '@supabase/supabase-js'
import type { VersionOrigin, VersionPhase } from '@sala/shared'

export type Version = {
  id: string; piece_id: string; number: number; origin: VersionOrigin; phase: VersionPhase
  image_path: string | null; caption: string | null; author_id: string | null; created_at: string
}

const VERSION_COLUMNS = 'id, piece_id, number, origin, phase, image_path, caption, author_id, created_at'

/** The piece's versions, by number. */
export async function loadVersions(client: SupabaseClient, pieceId: string): Promise<Version[]> {
  const { data, error } = await client.from('piece_versions').select(VERSION_COLUMNS).eq('piece_id', pieceId).order('number')
  if (error) throw error
  return data as Version[]
}
