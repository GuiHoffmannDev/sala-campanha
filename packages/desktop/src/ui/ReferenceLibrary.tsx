import { useState, type ChangeEvent } from 'react'
import { friendlyError } from '../data/errors.ts'
import { checkImageFile, IMAGE_TYPES } from '../data/files.ts'
import type { Reference } from '../data/references.ts'

type Props = {
  references: Reference[]
  urls: Record<string, string>
  canUpload: boolean
  selectable: boolean
  selected: string[]
  onUpload(files: File[]): Promise<void>
  onSelect(ids: string[]): void
}

export function ReferenceLibrary({ references, urls, canUpload, selectable, selected, onUpload, onSelect }: Props) {
  const [selection, setSelection] = useState(selected)
  const [errors, setErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!canUpload || uploading || !files.length) return
    const rejected: string[] = []
    const accepted = files.filter((file) => {
      const message = checkImageFile(file)
      if (message) rejected.push(`${file.name}: ${message}`)
      return message === null
    })
    setErrors(rejected)
    if (!accepted.length) return
    setUploading(true)
    try {
      await onUpload(accepted)
    } catch (e) {
      setErrors([...rejected, friendlyError(e)])
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="reference-library" aria-label="Biblioteca de referências">
      <h2>Referências</h2>
      {canUpload && <label>Enviar fotos
        <input type="file" accept={IMAGE_TYPES.join(',')} multiple disabled={uploading} onChange={(e) => void upload(e)} />
      </label>}
      {uploading && <p role="status">Enviando fotos…</p>}
      {errors.map((message, index) => <p role="alert" key={index}>{message}</p>)}
      {!references.length && <p className="shell-empty">Nenhuma referência nesta campanha.</p>}
      <ul className="reference-grid">
        {references.map((reference) => (
          <li key={reference.id}>
            {urls[reference.storage_path]
              ? <img src={urls[reference.storage_path]} alt={reference.original_name} />
              : <div className="reference-placeholder" aria-hidden="true" />}
            {selectable ? (
              <label>
                <input type="checkbox" checked={selection.includes(reference.id)} onChange={(e) => {
                  setSelection(e.target.checked ? [...selection, reference.id] : selection.filter((id) => id !== reference.id))
                }} />
                {reference.original_name}
              </label>
            ) : <span>{reference.original_name}</span>}
          </li>
        ))}
      </ul>
      {selectable && <button type="button" onClick={() => onSelect(selection)}>Usar selecionadas</button>}
    </section>
  )
}
