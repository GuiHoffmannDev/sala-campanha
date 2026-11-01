import { useState } from 'react'
import { PIECE_KINDS, type PieceKind } from '@sala/shared'
import type { Piece } from '../data/campaigns.ts'
import { KIND_LABELS, STATUS_LABELS } from '../lib/labels.ts'
import { NameForm } from './NameForm.tsx'

type Props = {
  pieces: Piece[]
  /** Piece id to a signed URL of its newest image. */
  thumbnails: Record<string, string>
  selectedId: string | null
  canWrite: boolean
  onSelect(pieceId: string): void
  onCreatePiece(title: string, kind: PieceKind): Promise<void>
}

export function PieceList({ pieces, thumbnails, selectedId, canWrite, onSelect, onCreatePiece }: Props) {
  const [creating, setCreating] = useState(false)
  const [kind, setKind] = useState<PieceKind>('imagem')

  return (
    <section className="piece-list" aria-label="Peças da campanha">
      <ul>
        {pieces.map((p) => (
          <li key={p.id}>
            <button
              type="button" className="piece-card" aria-current={p.id === selectedId ? 'page' : undefined}
              onClick={() => onSelect(p.id)}
            >
              {thumbnails[p.id] ? <img src={thumbnails[p.id]} alt="" /> : <span className="piece-thumb-empty" />}
              <span className="piece-title">{p.title}</span>
              <span className="piece-kind">{KIND_LABELS[p.kind]}</span>
              <span className={`status status-${p.status}`}>{STATUS_LABELS[p.status]}</span>
            </button>
          </li>
        ))}
      </ul>
      {canWrite && (creating ? (
        <NameForm
          label="Título da peça" submitLabel="Criar peça" onCancel={() => setCreating(false)}
          onSubmit={async (title) => {
            await onCreatePiece(title, kind)
            setCreating(false)
          }}
        >
          <label>
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value as PieceKind)}>
              {PIECE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </label>
        </NameForm>
      ) : (
        <button type="button" onClick={() => setCreating(true)}>Nova peça</button>
      ))}
    </section>
  )
}
