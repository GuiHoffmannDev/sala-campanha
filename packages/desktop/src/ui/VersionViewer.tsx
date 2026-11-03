import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Role } from '@sala/shared'
import type { Piece } from '../data/campaigns.ts'
import { friendlyError } from '../data/errors.ts'
import type { Version } from '../data/versions.ts'
import { pieceActions } from '../lib/actions.ts'

type Props = {
  piece: Piece
  role: Role
  versions: Version[]
  versionId: string
  approvedIds: Set<string>
  imageUrls: Record<string, string>
  onSelectVersion(id: string): void
  onApprove(id: string): Promise<void>
  onSaveCaption(id: string, caption: string): Promise<void>
  onDownload(version: Version): Promise<void>
  onClose(): void
  children?: ReactNode
}

export function VersionViewer({ piece, role, versions, versionId, approvedIds, imageUrls,
  onSelectVersion, onApprove, onSaveCaption, onDownload, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const index = versions.findIndex((v) => v.id === versionId)
  const version = versions[index]
  const [caption, setCaption] = useState(version?.caption ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = dialog.current!
    el.showModal()
    return () => el.close()
  }, [])

  useEffect(() => {
    setCaption(version?.caption ?? '')
    setError(null)
  }, [version?.id, version?.caption])

  if (!version) return null
  const actions = pieceActions(role, piece, { phase: version.phase, approved: approvedIds.has(version.id) })
  const title = `${piece.title} — Versão ${version.number}`
  const dirty = caption !== (version.caption ?? '')

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await action() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="version-dialog" aria-labelledby={titleId} onClose={onClose}
    onCancel={(e) => { if (busy) e.preventDefault() }}>
    <div className="dialog-actions">
      <h2 id={titleId}>{title}</h2>
      <button type="button" onClick={onClose} disabled={busy}>Fechar</button>
    </div>
    <nav className="dialog-actions" aria-label="Versões da peça">
      <button type="button" disabled={busy || index === 0} onClick={() => onSelectVersion(versions[index - 1]!.id)}>Versão anterior</button>
      <button type="button" disabled={busy || index === versions.length - 1} onClick={() => onSelectVersion(versions[index + 1]!.id)}>Próxima versão</button>
    </nav>
    {version.image_path && (imageUrls[version.image_path]
      ? <img className="version-image" src={imageUrls[version.image_path]} alt={title} />
      : <p role="status">Imagem indisponível.</p>)}
    {piece.kind !== 'imagem' && (actions.editCaption
      ? <form onSubmit={(e) => { e.preventDefault(); void run(() => onSaveCaption(version.id, caption)) }}>
        <label>Legenda<textarea value={caption} onChange={(e) => setCaption(e.target.value)} required disabled={busy} /></label>
        <button type="submit" disabled={busy || !dirty || !caption.trim()}>Salvar legenda</button>
      </form>
      : <p className="version-caption">{version.caption}</p>)}
    <div className="dialog-actions">
      {actions.approve && <button type="button" disabled={busy || dirty} onClick={() => void run(() => onApprove(version.id))}>Aprovar esta versão</button>}
      {version.image_path && <button type="button" disabled={busy} onClick={() => void run(() => onDownload(version))}>Baixar</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    <section aria-label="Comentários da versão">{children}</section>
  </dialog>
}
