import type { SupabaseClient } from '@supabase/supabase-js'
import { UserFacingError } from './errors.ts'
import { checkImageFile, newImagePath, uploadImage } from './files.ts'

export type Reference = {
  id: string; campaign_id: string; team_id: string; storage_path: string; original_name: string; created_at: string
}

const COLUMNS = 'id, campaign_id, team_id, storage_path, original_name, created_at'

export async function loadReferences(client: SupabaseClient, campaignId: string): Promise<Reference[]> {
  const { data, error } = await client.from('reference_assets').select(COLUMNS)
    .eq('campaign_id', campaignId).order('created_at').order('id')
  if (error) throw error
  return data as Reference[]
}

export async function addReference(
  client: SupabaseClient, input: { teamId: string; campaignId: string; file: File },
): Promise<Reference> {
  const message = checkImageFile(input.file)
  if (message) throw new UserFacingError(message)
  const path = newImagePath(input.teamId, input.campaignId, input.file.type)
  await uploadImage(client, path, input.file)
  // Members cannot delete orphaned uploads; cleanup requires the server's service role.
  const { data, error } = await client.from('reference_assets').insert({
    team_id: input.teamId, campaign_id: input.campaignId, storage_path: path, original_name: input.file.name,
  }).select(COLUMNS).single()
  if (error) throw error
  return data as Reference
}
