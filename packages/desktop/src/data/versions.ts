import type { SupabaseClient } from '@supabase/supabase-js'
import type { VersionOrigin, VersionPhase } from '@sala/shared'
import type { Piece } from './campaigns.ts'
import { UserFacingError } from './errors.ts'
import { checkImageFile, newImagePath, uploadImage } from './files.ts'

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

export async function approveVersion(client: SupabaseClient, pieceId: string, versionId: string): Promise<void> {
  const { error } = await client.rpc('approve_version', { p_piece: pieceId, p_version: versionId })
  if (error) throw error
}

export async function stepBack(client: SupabaseClient, pieceId: string): Promise<void> {
  const { error } = await client.rpc('step_back', { p_piece: pieceId })
  if (error) throw error
}

export async function uploadFinalVersion(
  client: SupabaseClient, input: { piece: Piece; file: File | null; caption: string | null },
): Promise<Version> {
  const { piece, file, caption } = input
  let path: string | null = null
  if (piece.kind !== 'texto') {
    if (!file) throw new UserFacingError('Choose a PNG, JPG or WebP image.')
    const message = checkImageFile(file)
    if (message) throw new UserFacingError(message)
    path = newImagePath(piece.team_id, piece.id, file.type)
    await uploadImage(client, path, file)
  }
  // shortcut: a failed RPC leaves an immutable upload for server cleanup; add a server upload flow if these accumulate.
  const { data, error } = await client.rpc('upload_final_version', {
    p_piece: piece.id, p_image_path: path, p_caption: piece.kind === 'imagem' ? null : caption,
  })
  if (error) throw error
  return data as Version
}

export async function updateCaption(client: SupabaseClient, versionId: string, caption: string): Promise<Version> {
  const { data, error } = await client.rpc('update_caption', { p_version: versionId, p_caption: caption })
  if (error) throw error
  return data as Version
}
