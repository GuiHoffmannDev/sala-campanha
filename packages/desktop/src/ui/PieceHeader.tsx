import { useEffect, useState, type KeyboardEvent } from 'react'
import { PIECE_STATUSES, type Role } from '@sala/shared'
import type { Campaign, Piece } from '../data/campaigns.ts'
import type { Member } from '../data/team.ts'
import { friendlyError } from '../data/errors.ts'
import { buildLink } from '../lib/link.ts'
import { copyText } from '../native.ts'
import { pieceActions } from '../lib/actions.ts'
import { STATUS_LABELS } from '../lib/labels.ts'

type Props = {
  campaign: Campaign | null
  piece: Piece | null
  canWrite: boolean
  role: Role
  membersInPiece?: Member[]
  onRename(title: string): Promise<void>
  onStepBack(): Promise<void>
  onUploadFinal(): void
}

const COPIED_MS = 2_000

export function PieceHeader({ campaign, piece, canWrite, role, membersInPiece = [], onRename, onStepBack, onUploadFinal }: Props) {
  const [draft, setDraft] = useState(piece?.title ?? '')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A new piece, or a rename that arrived live, replaces the draft.
  useEffect(() => {
    setDraft(piece?.title ?? '')
    setError(null)
  }, [piece?.id, piece?.title])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  if (!campaign) return <header className="piece-header" />
  const actions = piece ? pieceActions(role, piece, null) : null

  async function back() {
    if (!piece) return
    const previous = piece.kind === 'texto' && piece.status === 'aprovada'
      ? 'base_em_revisao' : PIECE_STATUSES[PIECE_STATUSES.indexOf(piece.status) - 1]
    if (!previous || !window.confirm(`Voltar a peça de ${STATUS_LABELS[piece.status]} para ${STATUS_LABELS[previous]}?`)) return
    setBusy(true)
    setError(null)
    try { await onStepBack() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  async function saveTitle() {
    if (!piece) return
    const title = draft.trim()
    // A blank title is not saved; the field goes back to the current one.
    if (!title || title === piece.title) {
      setDraft(piece.title)
      return
    }
    try {
      await onRename(title)
    } catch (e) {
      setError(friendlyError(e))
      setDraft(piece.title)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      setDraft(piece?.title ?? '')
      e.currentTarget.blur()
    }
  }

  async function share() {
    if (!campaign) return
    setError(null)
    try {
      await copyText(buildLink({ campaignId: campaign.id, pieceId: piece?.id }))
      setCopied(true)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <header className="piece-header">
      <div className="piece-header-names">
        <h1>{campaign.name}</h1>
        {piece && (canWrite ? (
          <input
            className="piece-title-input" aria-label="Título da peça" value={draft} maxLength={80}
            onChange={(e) => setDraft(e.target.value)} onBlur={() => void saveTitle()} onKeyDown={onKeyDown}
          />
        ) : (
          <h2>{piece.title}</h2>
        ))}
      </div>
      {piece && <span className={`status status-${piece.status}`}>{STATUS_LABELS[piece.status]}</span>}
      {/* Avatars of who is on the piece now (Task 11). */}
      <div className="piece-avatars" role={piece ? 'group' : undefined} aria-label={piece ? 'Nesta peça' : undefined}>
        {piece && membersInPiece.map((m) => (
          <span key={m.userId} className="piece-avatar" role="img" aria-label={m.displayName} title={m.displayName}>
            {m.displayName.trim().split(/\s+/u).slice(0, 2).map((name) => Array.from(name)[0] ?? '').join('').toLocaleUpperCase('pt-BR')}
          </span>
        ))}
      </div>
      <div className="piece-share">
        {actions?.stepBack && <button type="button" disabled={busy} onClick={() => void back()}>Voltar uma etapa</button>}
        {actions?.uploadFinal && <button type="button" disabled={busy} onClick={onUploadFinal}>Enviar versão final</button>}
        {copied && <span role="status">Link copiado</span>}
        <button type="button" onClick={() => void share()}>Compartilhar</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </header>
  )
}
