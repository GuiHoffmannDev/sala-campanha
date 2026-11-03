import type { Role, VersionPhase } from '@sala/shared'
import type { SessionEvent } from '@sala/shared/events'
import type { Piece } from '../data/campaigns.ts'

export function pieceActions(
  role: Role, piece: Pick<Piece, 'kind' | 'status'>, version: { phase: VersionPhase; approved: boolean } | null,
): { approve: boolean; stepBack: boolean; uploadFinal: boolean; editCaption: boolean; comment: boolean; chat: boolean } {
  const writer = role !== 'espectador'
  const manager = role === 'admin' || role === 'gestor'
  const reviewing = version !== null && (
    (piece.status === 'base_em_revisao' && version.phase === 'base') ||
    (piece.status === 'final_em_revisao' && version.phase === 'final')
  )
  return {
    approve: manager && reviewing,
    stepBack: writer && piece.status !== 'gerando' && (piece.status !== 'aprovada' || manager),
    uploadFinal: writer && (piece.status === 'acabamento' || piece.status === 'final_em_revisao'),
    editCaption: writer && piece.kind !== 'imagem' && reviewing && !version?.approved,
    comment: writer,
    chat: writer,
  }
}

/** Past approvals keep a version immutable, including after a step back. */
export function approvedVersionIds(events: SessionEvent[]): Set<string> {
  return new Set(events.flatMap((e) => e.kind === 'approval' ? [e.body.version_id] : []))
}
