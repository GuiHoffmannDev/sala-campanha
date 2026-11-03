import { useEffect, useId, useRef, useState } from 'react'
import type { Piece } from '../data/campaigns.ts'
import { friendlyError } from '../data/errors.ts'
import { checkImageFile, IMAGE_TYPES } from '../data/files.ts'

type Props = {
  piece: Piece
  initialCaption: string | null
  onUpload(file: File | null, caption: string | null): Promise<void>
  onClose(): void
}

export function UploadFinalDialog({ piece, initialCaption, onUpload, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState(initialCaption ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsImage = piece.kind !== 'texto'
  const needsCaption = piece.kind !== 'imagem'

  useEffect(() => {
    const el = dialog.current!
    el.showModal()
    return () => el.close()
  }, [])

  async function submit() {
    if ((needsImage && !file) || (needsCaption && !caption.trim())) return
    if (file) {
      const message = checkImageFile(file)
      if (message) { setError(message); return }
    }
    setBusy(true)
    setError(null)
    try {
      await onUpload(needsImage ? file : null, needsCaption ? caption : null)
      onClose()
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="upload-final-dialog" aria-labelledby={titleId} onClose={onClose}
    onCancel={(e) => { if (busy) e.preventDefault() }}>
    <h2 id={titleId}>Enviar versão final</h2>
    <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {needsImage && <label>Imagem final<input type="file" accept={IMAGE_TYPES.join(',')} required disabled={busy}
        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }} /></label>}
      {needsCaption && <label>Legenda final<textarea value={caption} required disabled={busy}
        onChange={(e) => setCaption(e.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" disabled={busy || (needsImage && !file) || (needsCaption && !caption.trim())}>
          {busy ? 'Enviando…' : 'Enviar versão final'}
        </button>
      </div>
    </form>
  </dialog>
}
