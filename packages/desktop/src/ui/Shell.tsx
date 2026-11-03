import type { SupabaseClient } from '@supabase/supabase-js'
import type { PieceKind } from '@sala/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createCampaign, createPiece, loadCampaigns, loadPieces, loadThumbnails, renamePiece, subscribeLists,
  type Campaign, type Piece,
} from '../data/campaigns.ts'
import { friendlyError, UserFacingError } from '../data/errors.ts'
import { subscribeMentions } from '../data/events.ts'
import { joinTeamPresence } from '../data/presence.ts'
import { signedUrls } from '../data/files.ts'
import { addReference, loadReferences, type Reference } from '../data/references.ts'
import { loadMembers, type Member, type Membership } from '../data/team.ts'
import { stepBack } from '../data/versions.ts'
import type { Route } from '../lib/link.ts'
import { mentionNotice, onlineUsers, shouldNotify, usersInPiece, type PresenceMeta } from '../lib/presence.ts'
import { notify } from '../native.ts'
import { CampaignSidebar } from './CampaignSidebar.tsx'
import { Chat } from './Chat.tsx'
import { PieceHeader } from './PieceHeader.tsx'
import { PieceList } from './PieceList.tsx'
import { ReferenceLibrary } from './ReferenceLibrary.tsx'

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

type LoadName = 'members' | 'campaigns' | 'pieces' | 'presence'

/** The main screen: campaigns on the left, the open piece in the middle, the campaign's pieces on the right. */
export function Shell({ client, memberships, teamId, route, onNavigate, onSwitchWorkspace, onCreateWorkspace }: Props) {
  const role = memberships.find((m) => m.teamId === teamId)?.role
  const canWrite = role !== undefined && role !== 'espectador'
  const { campaignId, pieceId } = route
  const referenceScope = `${teamId}:${campaignId}:${pieceId}`
  const [openReferences, setOpenReferences] = useState<string | null>(null)
  const [uploadPieceId, setUploadPieceId] = useState<string | null>(null)
  const showingReferences = openReferences === referenceScope

  // Campaigns and people are tagged with their workspace, and pieces with their campaign, so a switch
  // never shows (or lets the person click) the previous workspace's or campaign's items while loading.
  const [campaigns, setCampaigns] = useState<{ teamId: string | null; list: Campaign[] }>({ teamId: null, list: [] })
  const [members, setMembers] = useState<{ teamId: string | null; list: Member[] }>({ teamId: null, list: [] })
  const [pieces, setPieces] = useState<{ campaignId: string | null; list: Piece[] }>({ campaignId: null, list: [] })
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [presence, setPresence] = useState<{ teamId: string; state: Record<string, PresenceMeta[]> } | null>(null)
  const presenceHandle = useRef<{ teamId: string; joined: Awaited<ReturnType<typeof joinTeamPresence>> } | null>(null)
  const presenceTask = useRef(Promise.resolve())
  const latestPiece = useRef(pieceId)
  latestPiece.current = pieceId
  const memberNames = useRef<Record<string, string>>({})
  // Bumped by live changes and by the person's own writes, to reload the lists.
  const [changes, setChanges] = useState(0)
  // One slot per load. Each load clears its own slot when it runs again, so an old failure never sticks
  // after a switch or a successful reload, and one load never hides another's failure.
  const [errors, setErrors] = useState<Record<LoadName, string | null>>({ members: null, campaigns: null, pieces: null, presence: null })
  const report = (load: LoadName, message: string | null) => setErrors((e) => ({ ...e, [load]: message }))
  const reload = useCallback(() => setChanges((n) => n + 1), [])

  useEffect(() => subscribeLists(client, teamId, campaignId, reload), [client, teamId, campaignId])

  useEffect(() => {
    let active = true
    let joined: Awaited<ReturnType<typeof joinTeamPresence>> | undefined
    let stopMentions: (() => void) | undefined
    const seen = new Set<number>()
    report('presence', null)

    // A fixed private topic must finish leaving before the same client joins it again.
    presenceTask.current = presenceTask.current.then(async () => {
      if (!active) return
      const { data: { session }, error } = await client.auth.getSession()
      if (error) throw error
      if (!active || !session) return
      await client.realtime.setAuth()
      if (!active) return
      stopMentions = subscribeMentions(client, teamId, (event) => {
        if (!active || !shouldNotify(event, session.user.id) || seen.has(event.id)) return
        seen.add(event.id)
        void (async () => {
          const { data, error } = await client.from('pieces').select('title').eq('id', event.piece_id).single()
          if (error) throw error
          if (!active) return
          const notice = mentionNotice(event, memberNames.current, data.title)
          await notify(notice.title, notice.body)
        })().catch((e: unknown) => { if (active) console.error('could not notify mention', e) })
      })
      joined = await joinTeamPresence(client, teamId, { user_id: session.user.id, piece_id: latestPiece.current },
        (state) => { if (active) setPresence({ teamId, state }) })
      if (!active) { await joined.leave(); return }
      presenceHandle.current = { teamId, joined }
      await joined.setPiece(latestPiece.current)
    }).catch((e: unknown) => { if (active) report('presence', friendlyError(e)) })

    return () => {
      active = false
      stopMentions?.()
      presenceHandle.current = null
      presenceTask.current = presenceTask.current.then(async () => { await joined?.leave() })
        .catch((e: unknown) => console.error('could not leave presence', e))
    }
  }, [client, teamId])

  useEffect(() => {
    const handle = presenceHandle.current
    if (handle?.teamId === teamId) {
      void handle.joined.setPiece(pieceId).catch((e: unknown) => report('presence', friendlyError(e)))
    }
  }, [teamId, pieceId])

  useEffect(() => {
    let active = true
    report('members', null)
    loadMembers(client, teamId).then(
      (list) => active && setMembers({ teamId, list }),
      (e: unknown) => active && report('members', friendlyError(e)),
    )
    return () => {
      active = false
    }
  }, [client, teamId])

  useEffect(() => {
    let active = true
    report('campaigns', null)
    loadCampaigns(client, teamId).then(
      (list) => active && setCampaigns({ teamId, list }),
      (e: unknown) => active && report('campaigns', friendlyError(e)),
    )
    return () => {
      active = false
    }
  }, [client, teamId, changes])

  useEffect(() => {
    report('pieces', null)
    if (!campaignId) {
      setPieces({ campaignId: null, list: [] })
      setThumbnails({})
      return
    }
    let active = true
    loadPieces(client, campaignId).then(
      (list) => active && setPieces({ campaignId, list }),
      (e: unknown) => active && report('pieces', friendlyError(e)),
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

  const campaignList = campaigns.teamId === teamId ? campaigns.list : []
  const memberList = members.teamId === teamId ? members.list : []
  memberNames.current = Object.fromEntries(memberList.map((m) => [m.userId, m.displayName]))
  const presenceState = presence?.teamId === teamId ? presence.state : {}
  const online = onlineUsers(presenceState)
  const inPiece = new Set(pieceId ? usersInPiece(presenceState, pieceId) : [])
  const error = errors.members ?? errors.campaigns ?? errors.pieces ?? errors.presence
  const campaign = campaignList.find((c) => c.id === campaignId) ?? null
  const pieceList = pieces.campaignId === campaignId ? pieces.list : []
  const piece = pieceList.find((p) => p.id === pieceId) ?? null

  function navigate(next: Route) {
    setOpenReferences(null)
    onNavigate(next)
  }

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
        memberships={memberships} teamId={teamId} campaigns={campaignList} pieces={pieceList} members={memberList} online={online}
        route={route} canWrite={canWrite} onNavigate={navigate} onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={onCreateWorkspace} onCreateCampaign={addCampaign}
      />
      <div className="shell-main">
        <PieceHeader key={pieceId} campaign={campaign} piece={piece} canWrite={canWrite} role={role ?? 'espectador'} onRename={rename}
          membersInPiece={memberList.filter((m) => inPiece.has(m.userId))}
          onStepBack={async () => { if (pieceId) { await stepBack(client, pieceId); reload() } }}
          onUploadFinal={() => { setOpenReferences(null); setUploadPieceId(pieceId) }} />
        {campaign && <div className="campaign-tools">
          <button type="button" aria-expanded={showingReferences}
            onClick={() => setOpenReferences(showingReferences ? null : referenceScope)}>
            {showingReferences ? (piece ? 'Voltar à peça' : 'Voltar à campanha') : 'Referências'}
          </button>
        </div>}
        {error && <p role="alert">{error}</p>}
        <main className="shell-center">
          {showingReferences && campaign
            ? <CampaignReferences key={referenceScope} client={client} teamId={teamId} campaignId={campaign.id} canUpload={canWrite} />
            : piece
            ? <Chat key={piece.id} client={client} piece={piece} role={role ?? 'espectador'} members={memberList}
              onChange={reload} uploadFinalOpen={uploadPieceId === piece.id} onCloseUpload={() => setUploadPieceId(null)} />
            : <p className="shell-empty">Escolha uma peça</p>}
        </main>
      </div>
      {campaignId && (
        <PieceList
          pieces={pieceList} thumbnails={thumbnails} selectedId={pieceId} canWrite={canWrite}
          onSelect={(id) => navigate({ campaignId, pieceId: id })} onCreatePiece={addPiece}
        />
      )}
    </div>
  )
}

function CampaignReferences({ client, teamId, campaignId, canUpload }: {
  client: SupabaseClient; teamId: string; campaignId: string; canUpload: boolean
}) {
  const [references, setReferences] = useState<Reference[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [changes, setChanges] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    loadReferences(client, campaignId).then(async (list) => {
      // shortcut: URLs are renewed when the library opens or uploads; add a timer if sessions exceed 1 h.
      const signed = await signedUrls(client, list.map((reference) => reference.storage_path))
      if (active) {
        setReferences(list)
        setUrls(signed)
      }
    }).catch((e: unknown) => active && setError(friendlyError(e)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [client, campaignId, changes])

  async function upload(files: File[]) {
    const errors: string[] = []
    for (const file of files) {
      try {
        await addReference(client, { teamId, campaignId, file })
      } catch (e) {
        errors.push(`${file.name}: ${friendlyError(e)}`)
      }
    }
    setChanges((n) => n + 1)
    if (errors.length) throw new UserFacingError(errors.join('\n'))
  }

  return <div className="campaign-references">
    {loading && <p role="status">Carregando referências…</p>}
    {error && <p role="alert">{error}</p>}
    <ReferenceLibrary references={references} urls={urls} canUpload={canUpload} selectable={false}
      selected={[]} onUpload={upload} onSelect={() => {}} />
  </div>
}
