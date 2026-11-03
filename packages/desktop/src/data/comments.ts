import type { SupabaseClient } from '@supabase/supabase-js'
import { UserFacingError } from './errors.ts'

export type Comment = {
  id: string; version_id: string; piece_id: string; author_id: string | null; body: string
  x: number | null; y: number | null; text_start: number | null; text_end: number | null
  quote: string | null; parent_id: string | null; resolved: boolean; created_at: string
}

export type CommentTarget = { x: number; y: number } | { text_start: number; text_end: number; quote: string } | null
export type NewComment = { versionId: string; body: string; target: CommentTarget; parentId: string | null }

const COLUMNS = 'id, version_id, piece_id, author_id, body, x, y, text_start, text_end, quote, parent_id, resolved, created_at'

export async function loadComments(client: SupabaseClient, pieceId: string): Promise<Comment[]> {
  const { data, error } = await client.from('comments').select(COLUMNS).eq('piece_id', pieceId).order('created_at').order('id')
  if (error) throw error
  return data as Comment[]
}

export async function addComment(
  client: SupabaseClient, input: NewComment & { teamId: string; pieceId: string },
): Promise<Comment> {
  // The database defaults author_id to auth.uid() and validates the target and workspace through RLS.
  const { data, error } = await client.from('comments').insert({ team_id: input.teamId, piece_id: input.pieceId,
    version_id: input.versionId, body: input.body, parent_id: input.parentId, ...input.target,
  }).select(COLUMNS).single()
  if (error) throw error
  return data as Comment
}

export async function setResolved(client: SupabaseClient, commentId: string, resolved: boolean): Promise<void> {
  const { data, error } = await client.from('comments').update({ resolved }).eq('id', commentId).select('id')
  if (error) throw error
  // RLS can hide a row from UPDATE without returning an error.
  if (!data.length) throw new UserFacingError('Você não tem permissão para isso.')
}
