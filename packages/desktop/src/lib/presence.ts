import type { SessionEvent } from '@sala/shared/events'

export type PresenceMeta = { user_id: string; piece_id: string | null }

export function onlineUsers(state: Record<string, PresenceMeta[]>): Set<string> {
  return new Set(Object.values(state).flat().map((meta) => meta.user_id))
}

export function usersInPiece(state: Record<string, PresenceMeta[]>, pieceId: string): string[] {
  return [...new Set(Object.values(state).flat().filter((meta) => meta.piece_id === pieceId).map((meta) => meta.user_id))]
}

export function shouldNotify(event: SessionEvent, me: string): boolean {
  return event.kind === 'user_message' && event.author_id !== me && event.mention_user_ids.includes(me)
}

export function mentionNotice(event: SessionEvent, members: Record<string, string>, pieceTitle: string): { title: string; body: string } {
  const body = Array.from(`${pieceTitle}: ${event.kind === 'user_message' ? event.body.text : ''}`)
  return {
    title: `${(event.author_id && members[event.author_id]) || 'Someone'} mentioned you`,
    body: body.length > 120 ? `${body.slice(0, 119).join('')}…` : body.join(''),
  }
}
