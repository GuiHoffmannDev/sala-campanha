import type { SupabaseClient } from '@supabase/supabase-js'
import type { PieceKind, PieceStatus } from '@sala/shared'
import type { Route } from '../lib/link.ts'
import { UserFacingError } from './errors.ts'

export type Campaign = { id: string; team_id: string; name: string; created_at: string }
export type Piece = {
  id: string; campaign_id: string; team_id: string; title: string; kind: PieceKind; status: PieceStatus
  approved_version_id: string | null; created_at: string
}

const CAMPAIGN_COLUMNS = 'id, team_id, name, created_at'
const PIECE_COLUMNS = 'id, campaign_id, team_id, title, kind, status, approved_version_id, created_at'
const NOT_FOUND = 'Piece not found or access denied.'

/** The workspace's campaigns, oldest first. */
export async function loadCampaigns(client: SupabaseClient, teamId: string): Promise<Campaign[]> {
  const { data, error } = await client.from('campaigns').select(CAMPAIGN_COLUMNS)
    .eq('team_id', teamId).order('created_at').order('id')
  if (error) throw error
  return data as Campaign[]
}

export async function createCampaign(client: SupabaseClient, teamId: string, name: string): Promise<Campaign> {
  const { data, error } = await client.from('campaigns').insert({ team_id: teamId, name: name.trim() })
    .select(CAMPAIGN_COLUMNS).single()
  if (error) throw error
  return data as Campaign
}

/** The campaign's pieces, oldest first. */
export async function loadPieces(client: SupabaseClient, campaignId: string): Promise<Piece[]> {
  const { data, error } = await client.from('pieces').select(PIECE_COLUMNS)
    .eq('campaign_id', campaignId).order('created_at').order('id')
  if (error) throw error
  return data as Piece[]
}

export async function createPiece(
  client: SupabaseClient, input: { campaignId: string; teamId: string; title: string; kind: PieceKind },
): Promise<Piece> {
  const { data, error } = await client.from('pieces')
    .insert({ campaign_id: input.campaignId, team_id: input.teamId, title: input.title.trim(), kind: input.kind })
    .select(PIECE_COLUMNS).single()
  if (error) throw error
  return data as Piece
}

export async function renamePiece(client: SupabaseClient, pieceId: string, title: string): Promise<void> {
  const { data, error } = await client.from('pieces').update({ title: title.trim() }).eq('id', pieceId).select('id')
  if (error) throw error
  // RLS hides a piece the person cannot write instead of failing the update.
  if (!data.length) throw new UserFacingError('You cannot edit this piece.')
}

/** For each piece of the campaign with an image, the `image_path` of its newest version with one. */
export async function loadThumbnails(client: SupabaseClient, campaignId: string): Promise<Record<string, string>> {
  // pieces and piece_versions are linked both ways; the hint names the version -> piece link.
  const { data, error } = await client.from('piece_versions')
    .select('piece_id, image_path, pieces!piece_versions_piece_id_team_id_fkey!inner(campaign_id)')
    .eq('pieces.campaign_id', campaignId).not('image_path', 'is', null).order('number', { ascending: false })
  if (error) throw error
  const thumbnails: Record<string, string> = {}
  for (const v of data as unknown as { piece_id: string; image_path: string }[]) thumbnails[v.piece_id] ??= v.image_path
  return thumbnails
}

/**
 * Checks a route from a link against what the person can see. The piece decides
 * the campaign, and `teamId` is the workspace to open. A campaign or piece that
 * does not load (missing or another team's) gives no route and a notice.
 */
export async function resolveRoute(
  client: SupabaseClient, route: Route,
): Promise<{ route: Route; teamId: string | null; notice: string | null }> {
  const missing = { route: { campaignId: null, pieceId: null }, teamId: null, notice: NOT_FOUND }
  if (route.pieceId) {
    const { data, error } = await client.from('pieces').select('campaign_id, team_id').eq('id', route.pieceId).maybeSingle()
    if (error) throw error
    return data ? { route: { campaignId: data.campaign_id, pieceId: route.pieceId }, teamId: data.team_id, notice: null } : missing
  }
  if (route.campaignId) {
    const { data, error } = await client.from('campaigns').select('team_id').eq('id', route.campaignId).maybeSingle()
    if (error) throw error
    return data ? { route: { campaignId: route.campaignId, pieceId: null }, teamId: data.team_id, notice: null } : missing
  }
  return { route, teamId: null, notice: null }
}

/** Calls `onChange` when a campaign is added to the workspace or a piece of the open campaign is added or changed. */
export function subscribeLists(
  client: SupabaseClient, teamId: string, campaignId: string | null, onChange: () => void,
): () => void {
  // A fresh topic per call: React may unmount and remount before the old channel is gone.
  const channel = client.channel(`lists:${teamId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'campaigns', filter: `team_id=eq.${teamId}` }, onChange)
  if (campaignId) {
    const filter = `campaign_id=eq.${campaignId}`
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pieces', filter }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pieces', filter }, onChange)
  }
  channel.subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
