import type { SupabaseClient } from '@supabase/supabase-js'
import type { PresenceMeta } from '../lib/presence.ts'

export async function joinTeamPresence(
  client: SupabaseClient, teamId: string, me: PresenceMeta,
  onSync: (state: Record<string, PresenceMeta[]>) => void,
  signal?: AbortSignal,
): Promise<{ setPiece(pieceId: string | null): Promise<void>; leave(): Promise<void> }> {
  signal?.throwIfAborted()
  await client.realtime.setAuth()
  signal?.throwIfAborted()
  let current = { ...me }
  let left = false
  let ready = false
  let trackRetry: ReturnType<typeof setTimeout> | undefined
  const channel = client.channel(`team:${teamId}`, {
    config: { private: true, presence: { key: me.user_id } },
  }).on('presence', { event: 'sync' }, () => {
    if (!left) onSync(channel.presenceState<PresenceMeta>())
  })

  async function track() {
    const status = await channel.track(current)
    if (status !== 'ok') throw new Error(`Presence track failed: ${status}`)
  }

  async function leave() {
    if (left) return
    left = true
    clearTimeout(trackRetry)
    await client.removeChannel(channel)
  }

  let cancelJoin = () => {}
  try {
    await new Promise<void>((resolve, reject) => {
      cancelJoin = () => reject(signal?.reason)
      signal?.addEventListener('abort', cancelJoin, { once: true })
      const publish = () => {
        clearTimeout(trackRetry)
        if (left || channel.state !== 'joined') return
        void track().then(() => { if (!left) { ready = true; resolve() } }, (e: unknown) => {
          if (left) return
          onSync({})
          if (ready) console.error('could not restore presence', e)
          // A lost acknowledgement may leave the socket joined, with no rejoin to retry tracking.
          if (channel.state === 'joined') trackRetry = setTimeout(publish, 3_000)
        })
      }
      channel.subscribe((status, error) => {
        if (left) return
        if (status === 'SUBSCRIBED') {
          // Every rejoin must publish the latest location, including changes made while offline.
          publish()
        } else {
          onSync({})
          const reason = (error?.cause as { reason?: unknown } | undefined)?.reason
          const denied = typeof reason === 'string' && /^(?:Unauthorized: )?You do not have permissions to read from this Channel topic:/u.test(reason)
          // Socket failures and timeouts rejoin through the SDK; an authorization denial must stop.
          if (status === 'CLOSED' || denied) {
            if (!ready) reject(error ?? new Error(`Presence subscribe failed: ${status}`))
            else void leave().catch((e: unknown) => console.error('could not leave presence', e))
          }
        }
      })
    })
  } catch (e) {
    await leave()
    throw e
  } finally {
    signal?.removeEventListener('abort', cancelJoin)
  }

  return {
    async setPiece(pieceId) {
      if (left) return
      current = { ...current, piece_id: pieceId }
      if (channel.state === 'joined') await track()
    },
    leave,
  }
}
