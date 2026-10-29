import { useState, type FormEvent } from 'react'
import { friendlyError } from '../data/errors.ts'

type Props = {
  step: 'name' | 'workspace'
  /** The person's name: the field itself on the name step, the first name in "Workspace de <nome>" on the workspace step. */
  suggestedName: string
  onSaveName(name: string): Promise<void>
  onCreateWorkspace(name: string): Promise<void>
}

const TEXT = {
  name: { title: 'Como você quer aparecer para o time?', field: 'Seu nome', submit: 'Continuar' },
  workspace: { title: 'Crie seu workspace', field: 'Nome do workspace', submit: 'Criar' },
}

function initialValue(step: Props['step'], suggestedName: string): string {
  if (step === 'name') return suggestedName
  const firstName = suggestedName.trim().split(/\s+/)[0]
  return firstName ? `Workspace de ${firstName}` : ''
}

export function Onboarding({ step, suggestedName, onSaveName, onCreateWorkspace }: Props) {
  const [value, setValue] = useState(() => initialValue(step, suggestedName))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = TEXT[step]
  const trimmed = value.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await (step === 'name' ? onSaveName(trimmed) : onCreateWorkspace(trimmed))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="onboarding" onSubmit={submit}>
      <h2>{text.title}</h2>
      <label>
        {text.field}
        {/* The server refuses names over 80 characters. */}
        <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} required autoFocus />
      </label>
      <button type="submit" disabled={!trimmed || busy}>{text.submit}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
