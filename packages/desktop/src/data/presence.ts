import type { SupabaseClient } from '@supabase/supabase-js'
import type { PresenceMeta } from '../lib/presence.ts'

export async function joinTeamPresence(
  client: SupabaseClient, teamId: string, me: PresenceMeta,
  onSync: (state: Record<string, PresenceMeta[]>) => void,
): Promise<{ setPiece(pieceId: string | null): Promise<void>; leave(): Promise<void> }> {
  await client.realtime.setAuth()
  let current = { ...me }
  let left = false
  let ready = false
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
    await client.removeChannel(channel)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (left) return
        if (status === 'SUBSCRIBED') {
          // Every rejoin must publish the latest location, including changes made while offline.
          void track().then(() => { ready = true; resolve() }, (e: unknown) => {
            if (!ready) reject(e)
            else { onSync({}); console.error('could not restore presence', e) }
          })
        } else {
          onSync({})
          if (!ready) reject(error ?? new Error(`Presence subscribe failed: ${status}`))
        }
      })
    })
  } catch (e) {
    await leave()
    throw e
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
