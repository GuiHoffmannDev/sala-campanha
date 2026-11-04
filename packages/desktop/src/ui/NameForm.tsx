import { useState, type FormEvent, type ReactNode } from 'react'
import { friendlyError } from '../data/errors.ts'

type Props = {
  label: string
  submitLabel: string
  onSubmit(name: string): Promise<void>
  onCancel(): void
  /** Extra fields, such as the piece kind. */
  children?: ReactNode
}

/** A small inline form for one name: blank names are not sent, and a failure shows the friendly text. */
export function NameForm({ label, submitLabel, onSubmit, onCancel, children }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = value.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <form className="name-form" onSubmit={submit}>
      <label>
        {label}
        <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} required autoFocus />
      </label>
      {children}
      <div className="name-form-actions">
        <button type="submit" disabled={!trimmed || busy}>{submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
