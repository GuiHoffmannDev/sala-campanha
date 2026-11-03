import type { SupabaseClient } from '@supabase/supabase-js'
import type { Provider, Role } from '@sala/shared'
import type { SessionEvent } from '@sala/shared/events'
import { useEffect, useMemo, useRef, useState } from 'react'
import { friendlyError } from '../data/errors.ts'
import type { Piece } from '../data/campaigns.ts'
import { loadEvents, postMessage, subscribePiece } from '../data/events.ts'
import { signedUrls } from '../data/files.ts'
import { loadKeyedProviders } from '../data/keys.ts'
import { loadReferences, type Reference } from '../data/references.ts'
import type { Member } from '../data/team.ts'
import { loadVersions, type Version } from '../data/versions.ts'
import { gapFillAfter, gapFillSince, mergeEvents, timelineItems } from '../lib/timeline.ts'
import { Timeline } from './Timeline.tsx'
import { Composer } from './Composer.tsx'

// How long a failed gap fill waits before it tries again.
const RETRY_MS = 3_000
// Within this distance of the end, the list counts as following the conversation.
const BOTTOM_SLACK_PX = 40

type Props = {
  client: SupabaseClient
  /** Mount with `key={piece.id}`: the state belongs to one piece. */
  piece: Piece
  role: Role
  members: Member[]
}

/** The live conversation of one piece. */
export function Chat({ client, piece, role, members }: Props) {
  const pieceId = piece.id
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [me, setMe] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [composerData, setComposerData] = useState<{
    keyed: Provider[]; references: Reference[]; urls: Record<string, string>
  } | null>(null)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [composerChanges, setComposerChanges] = useState(0)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const refresh = useRef<() => void>(() => {})
  // Bumped by a new version, to reload the list.
  const [versionChanges, setVersionChanges] = useState(0)
  // The join callback outlives renders; it reads the latest events from here.
  const latest = useRef<SessionEvent[]>([])
  const list = useRef<HTMLDivElement>(null)
  // Whether the person is at the end; a late image only scrolls the list then.
  const pinned = useRef(true)

  useEffect(() => {
    latest.current = events
  }, [events])

  useEffect(() => {
    let active = true
    void client.auth.getSession().then(({ data }) => active && setMe(data.session?.user.id ?? ''))
    // Live events received while a fill is loading. Realtime keeps commit order, so they are at
    // least as new as the fill's snapshot and must win over it (a delivery can also go back to queued).
    let liveLog: SessionEvent[] = []
    let pendingFills = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const fill = () => {
      const start = liveLog.length
      pendingFills += 1
      const settle = () => {
        const liveSince = liveLog.slice(start)
        pendingFills -= 1
        if (!pendingFills) liveLog = []
        return liveSince
      }
      loadEvents(client, pieceId, gapFillAfter(latest.current), gapFillSince(latest.current)).then(
        (loaded) => {
          const liveSince = settle()
          if (!active) return
          setError(null)
          setEvents((current) => mergeEvents(mergeEvents(current, loaded), liveSince))
          setHistoryLoaded(true)
        },
        (e: unknown) => {
          settle()
          if (!active) return
          setError(friendlyError(e))
          // Realtime never resends what the gap hid, and the next join may not come: try again.
          retry ??= setTimeout(() => {
            retry = undefined
            fill()
          }, RETRY_MS)
        },
      )
    }
    // The first load does not wait for the channel: the history shows even if Realtime is down.
    refresh.current = fill
    fill()
    const stop = subscribePiece(client, pieceId, {
      onEvent: (e) => {
        if (pendingFills) liveLog.push(e)
        setEvents((current) => mergeEvents(current, [e]))
      },
      onVersion: () => setVersionChanges((n) => n + 1),
      // Comments and the piece header are drawn elsewhere.
      onComment() {},
      onPiece() {},
      // Versions created while offline send no onVersion, so a (re)join reloads them too.
      onSubscribed: () => {
        fill()
        setVersionChanges((n) => n + 1)
        setComposerChanges((n) => n + 1)
      },
    })
    return () => {
      active = false
      refresh.current = () => {}
      clearTimeout(retry)
      stop()
    }
  }, [client, pieceId])

  useEffect(() => {
    if (role === 'espectador') return
    let active = true
    setComposerError(null)
    Promise.all([loadKeyedProviders(client, piece.team_id), loadReferences(client, piece.campaign_id)])
      .then(async ([keyed, references]) => {
        // shortcut: reference URLs renew on mount or reconnect; add a timer if sessions exceed 1 h.
        const urls = await signedUrls(client, references.map((r) => r.storage_path))
        if (active) setComposerData({ keyed, references, urls })
      })
      .catch((e: unknown) => active && setComposerError(friendlyError(e)))
    return () => { active = false }
  }, [client, piece.team_id, piece.campaign_id, role, composerChanges])

  useEffect(() => {
    let active = true
    loadVersions(client, pieceId)
      .then(async (loaded) => {
        if (!active) return
        setVersions(loaded)
        // shortcut: URLs last 1 h and are signed again only when the list reloads; add a timer if long sessions show broken images.
        const urls = await signedUrls(client, loaded.flatMap((v) => (v.image_path ? [v.image_path] : [])))
        if (active) setImageUrls(urls)
      })
      .catch((e: unknown) => active && setError(friendlyError(e)))
    return () => {
      active = false
    }
  }, [client, pieceId, versionChanges])

  const items = useMemo(() => timelineItems(events, {
    members: Object.fromEntries(members.map((m) => [m.userId, m.displayName])),
    versions: Object.fromEntries(versions.map((v) => [v.id, v])),
    me,
  }), [events, members, versions, me])

  const toBottom = () => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Follow the conversation down as items arrive.
  useEffect(toBottom, [items.length])

  const choices = events.flatMap((e) => e.kind === 'user_message' && e.to_agent ? [e.body.model] : [])

  return (
    <section className="piece-chat" aria-label="Chat da peça">
    <div
      className="chat"
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
      }}
    >
      {error && <p role="alert">{error}</p>}
      <Timeline items={items} imageUrls={imageUrls} onImageLoad={() => pinned.current && toBottom()} />
    </div>
    {role === 'espectador'
      ? <p className="shell-empty">Você acompanha esta peça como espectador.</p>
      : <>
        {composerError && <div><p role="alert">{composerError}</p>
          <button type="button" onClick={() => setComposerChanges((n) => n + 1)}>Tentar de novo</button></div>}
        {!composerData || !historyLoaded
          ? <p className="shell-empty" role="status">Carregando modelos e referências…</p>
          : <Composer piece={piece} members={members.map((m) => ({ userId: m.userId, name: m.displayName }))}
            keyed={composerData.keyed} choices={choices} references={composerData.references} urls={composerData.urls}
            onPost={async (input) => { await postMessage(client, input); refresh.current() }} />}
      </>}
    </section>
  )
}
