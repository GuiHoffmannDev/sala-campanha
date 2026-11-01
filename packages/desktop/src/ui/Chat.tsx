import type { SupabaseClient } from '@supabase/supabase-js'
import type { SessionEvent } from '@sala/shared/events'
import { useEffect, useMemo, useRef, useState } from 'react'
import { friendlyError } from '../data/errors.ts'
import { loadEvents, subscribePiece } from '../data/events.ts'
import { signedUrls } from '../data/files.ts'
import type { Member } from '../data/team.ts'
import { loadVersions, type Version } from '../data/versions.ts'
import { gapFillAfter, mergeEvents, timelineItems } from '../lib/timeline.ts'
import { Timeline } from './Timeline.tsx'

type Props = {
  client: SupabaseClient
  /** Mount with `key={pieceId}`: the state belongs to one piece. */
  pieceId: string
  members: Member[]
}

/** The live conversation of one piece. */
export function Chat({ client, pieceId, members }: Props) {
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [me, setMe] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Bumped by a new version, to reload the list.
  const [versionChanges, setVersionChanges] = useState(0)
  // The join callback outlives renders; it reads the latest events from here.
  const latest = useRef<SessionEvent[]>([])
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    latest.current = events
  }, [events])

  useEffect(() => {
    let active = true
    void client.auth.getSession().then(({ data }) => active && setMe(data.session?.user.id ?? ''))
    const fill = () => {
      loadEvents(client, pieceId, gapFillAfter(latest.current)).then(
        (loaded) => {
          if (!active) return
          setError(null)
          setEvents((current) => mergeEvents(current, loaded))
        },
        (e: unknown) => active && setError(friendlyError(e)),
      )
    }
    // The first load does not wait for the channel: the history shows even if Realtime is down.
    fill()
    const stop = subscribePiece(client, pieceId, {
      onEvent: (e) => setEvents((current) => mergeEvents(current, [e])),
      onVersion: () => setVersionChanges((n) => n + 1),
      // Comments and the piece header are drawn elsewhere.
      onComment() {},
      onPiece() {},
      onSubscribed: fill,
    })
    return () => {
      active = false
      stop()
    }
  }, [client, pieceId])

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

  // Follow the conversation down as items arrive.
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length])

  return (
    <div className="chat" ref={list}>
      {error && <p role="alert">{error}</p>}
      <Timeline items={items} imageUrls={imageUrls} />
    </div>
  )
}
