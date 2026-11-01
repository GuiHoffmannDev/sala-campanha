import type { SupabaseClient } from '@supabase/supabase-js'
import type { PieceKind } from '@sala/shared'
import { useEffect, useState } from 'react'
import {
  createCampaign, createPiece, loadCampaigns, loadPieces, loadThumbnails, renamePiece, subscribeLists,
  type Campaign, type Piece,
} from '../data/campaigns.ts'
import { friendlyError } from '../data/errors.ts'
import { signedUrls } from '../data/files.ts'
import { loadMembers, type Member, type Membership } from '../data/team.ts'
import type { Route } from '../lib/link.ts'
import { CampaignSidebar } from './CampaignSidebar.tsx'
import { PieceHeader } from './PieceHeader.tsx'
import { PieceList } from './PieceList.tsx'

type Props = {
  client: SupabaseClient
  memberships: Membership[]
  /** The open workspace; one of `memberships`. */
  teamId: string
  route: Route
  onNavigate(route: Route): void
  onSwitchWorkspace(teamId: string): void
  onCreateWorkspace(name: string): Promise<void>
}

/** The main screen: campaigns on the left, the open piece in the middle, the campaign's pieces on the right. */
export function Shell({ client, memberships, teamId, route, onNavigate, onSwitchWorkspace, onCreateWorkspace }: Props) {
  const role = memberships.find((m) => m.teamId === teamId)?.role
  const canWrite = role !== undefined && role !== 'espectador'
  const { campaignId, pieceId } = route

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [members, setMembers] = useState<Member[]>([])
  // Tagged with their campaign, so a campaign never shows the previous campaign's pieces while loading.
  const [pieces, setPieces] = useState<{ campaignId: string | null; list: Piece[] }>({ campaignId: null, list: [] })
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  // Bumped by live changes and by the person's own writes, to reload the lists.
  const [changes, setChanges] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const reload = () => setChanges((n) => n + 1)

  useEffect(() => subscribeLists(client, teamId, campaignId, reload), [client, teamId, campaignId])

  useEffect(() => {
    let active = true
    loadMembers(client, teamId).then(
      (list) => active && setMembers(list),
      (e: unknown) => active && setError(friendlyError(e)),
    )
    return () => {
      active = false
    }
  }, [client, teamId])

  useEffect(() => {
    let active = true
    loadCampaigns(client, teamId).then(
      (list) => active && setCampaigns(list),
      (e: unknown) => active && setError(friendlyError(e)),
    )
    return () => {
      active = false
    }
  }, [client, teamId, changes])

  useEffect(() => {
    if (!campaignId) {
      setPieces({ campaignId: null, list: [] })
      setThumbnails({})
      return
    }
    let active = true
    loadPieces(client, campaignId).then(
      (list) => active && setPieces({ campaignId, list }),
      (e: unknown) => active && setError(friendlyError(e)),
    )
    loadThumbnails(client, campaignId)
      .then(async (paths) => {
        const urls = await signedUrls(client, Object.values(paths))
        const byPiece: Record<string, string> = {}
        for (const [id, path] of Object.entries(paths)) if (urls[path]) byPiece[id] = urls[path]
        if (active) setThumbnails(byPiece)
      })
      // A missing thumbnail is not worth an alert; the card shows an empty frame.
      .catch((e: unknown) => console.error('could not load thumbnails', e))
    return () => {
      active = false
    }
  }, [client, campaignId, changes])

  const campaign = campaigns.find((c) => c.id === campaignId) ?? null
  const pieceList = pieces.campaignId === campaignId ? pieces.list : []
  const piece = pieceList.find((p) => p.id === pieceId) ?? null

  async function addCampaign(name: string) {
    const created = await createCampaign(client, teamId, name)
    reload()
    onNavigate({ campaignId: created.id, pieceId: null })
  }

  async function addPiece(title: string, kind: PieceKind) {
    if (!campaignId) return
    const created = await createPiece(client, { campaignId, teamId, title, kind })
    reload()
    onNavigate({ campaignId, pieceId: created.id })
  }

  async function rename(title: string) {
    if (!pieceId) return
    await renamePiece(client, pieceId, title)
    reload()
  }

  return (
    <div className="shell">
      <CampaignSidebar
        memberships={memberships} teamId={teamId} campaigns={campaigns} pieces={pieceList} members={members}
        route={route} canWrite={canWrite} onNavigate={onNavigate} onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={onCreateWorkspace} onCreateCampaign={addCampaign}
      />
      <div className="shell-main">
        <PieceHeader campaign={campaign} piece={piece} canWrite={canWrite} onRename={rename} />
        {error && <p role="alert">{error}</p>}
        <main className="shell-center">
          {/* The piece chat replaces this (Task 6). */}
          {!piece && <p className="shell-empty">Escolha uma peça</p>}
        </main>
      </div>
      {campaignId && (
        <PieceList
          pieces={pieceList} thumbnails={thumbnails} selectedId={pieceId} canWrite={canWrite}
          onSelect={(id) => onNavigate({ campaignId, pieceId: id })} onCreatePiece={addPiece}
        />
      )}
    </div>
  )
}
