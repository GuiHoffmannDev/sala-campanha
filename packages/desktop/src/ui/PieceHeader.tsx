import { useEffect, useState, type KeyboardEvent } from 'react'
import type { Campaign, Piece } from '../data/campaigns.ts'
import { friendlyError } from '../data/errors.ts'
import { buildLink } from '../lib/link.ts'
import { copyText } from '../native.ts'

type Props = {
  campaign: Campaign | null
  piece: Piece | null
  canWrite: boolean
  onRename(title: string): Promise<void>
}

const COPIED_MS = 2_000

export function PieceHeader({ campaign, piece, canWrite, onRename }: Props) {
  const [draft, setDraft] = useState(piece?.title ?? '')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      {/* Avatars of who is on the piece now (Task 11). */}
      <div className="piece-avatars" />
      <div className="piece-share">
        {copied && <span role="status">Link copiado</span>}
        <button type="button" onClick={() => void share()}>Compartilhar</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </header>
  )
}
