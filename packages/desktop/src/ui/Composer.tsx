import type { Provider } from '@sala/shared'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Piece } from '../data/campaigns.ts'
import { friendlyError } from '../data/errors.ts'
import type { PostInput } from '../data/events.ts'
import type { Reference } from '../data/references.ts'
import { initialPick, modelOptions, toModelChoice, type ModelPick } from '../lib/models.ts'
import { mentionedIn, mentionQuery, messageTarget, type Mention } from '../lib/routing.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { ReferenceLibrary } from './ReferenceLibrary.tsx'

type Props = {
  piece: Piece
  members: Mention[]
  keyed: Provider[]
  choices: unknown[]
  references: Reference[]
  urls: Record<string, string>
  onPost(input: PostInput): Promise<void>
}

export function Composer({ piece, members, keyed, choices, references, urls, onPost }: Props) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const [textPick, setTextPick] = useState<ModelPick | null>(null)
  const [imagePick, setImagePick] = useState<ModelPick | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [library, setLibrary] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const posting = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const mentions = mentionedIn(text, members)
  const target = messageTarget(text, mentions)
  const query = dismissed ? null : mentionQuery(text, caret)
  const suggestions = query === null ? [] : members.filter((m) => m.name.toLocaleLowerCase('pt-BR').startsWith(query.toLocaleLowerCase('pt-BR')))
  const textOptions = modelOptions('text', keyed)
  const imageOptions = modelOptions('image', keyed)
  const pickedText = textPick && textOptions.includes(textPick.model) ? textPick : initialPick(choices, 'text', keyed)
  const pickedImage = imagePick && imageOptions.includes(imagePick.model) ? imagePick : initialPick(choices, 'image', keyed)
  const attachments = references.filter((r) => selected.includes(r.id))
  const blocked = !text.trim() || (target.toAgent && !pickedText)

  async function post() {
    if (blocked || posting.current) return
    posting.current = true
    setSending(true)
    setError(null)
    try {
      await onPost({ pieceId: piece.id, text, mentionUserIds: mentions.map((m) => m.userId),
        model: target.toAgent && pickedText ? toModelChoice(piece.kind, pickedText, pickedImage) : null,
        referenceAssetIds: target.toAgent ? attachments.map((r) => r.id) : [] })
      setText('')
      setCaret(0)
      setSelected([])
      setLibrary(false)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      posting.current = false
      setSending(false)
    }
  }

  function insertMention(member: Mention) {
    const at = text.lastIndexOf('@', caret - 1)
    const next = `${text.slice(0, at)}@${member.name} ${text.slice(caret)}`
    const end = at + member.name.length + 2
    setText(next)
    setCaret(end)
    setDismissed(true)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(end, end)
    })
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      setDismissed(true)
    } else if (suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setActive((n) => (n + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const suggestion = suggestions[active]
      if (suggestion) insertMention(suggestion)
      else void post()
    }
  }

  return <form className="composer" aria-label="Enviar mensagem" onSubmit={(e) => { e.preventDefault(); void post() }}>
    <p id={`${id}-target`} aria-live="polite">{target.label}</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={sending}>
      <label>Mensagem
        <textarea ref={input} rows={3} value={text} aria-describedby={`${id}-target`}
          aria-autocomplete="list" aria-controls={suggestions.length ? `${id}-mentions` : undefined}
          aria-activedescendant={suggestions[active] ? `${id}-mention-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setActive(0)
            setDismissed(false)
          }} onSelect={(e) => setCaret(e.currentTarget.selectionStart)} onKeyDown={keyDown} />
      </label>
      {suggestions.length > 0 && <ul className="mention-list" id={`${id}-mentions`} role="listbox" aria-label="Membros">
        {suggestions.map((m, index) => <li key={m.userId} id={`${id}-mention-${index}`} role="option" aria-selected={active === index}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(m)}>{m.name}</button>
        </li>)}
      </ul>}
      {target.toAgent && <>
        <div className="composer-models">
          {pickedText && <ModelPicker capability="text" options={textOptions} value={pickedText} onChange={setTextPick} />}
          {piece.kind !== 'texto' && pickedImage && <ModelPicker capability="image" options={imageOptions} value={pickedImage} onChange={setImagePick} />}
        </div>
        {!pickedText && <p role="status">Nenhuma chave de texto cadastrada. Peça ao admin do time.</p>}
        <div className="composer-references">
          {attachments.map((r) => <button key={r.id} type="button" aria-label={`Remover ${r.original_name}`}
            onClick={() => setSelected(selected.filter((id) => id !== r.id))}>{r.original_name} ×</button>)}
        </div>
        <button type="button" aria-expanded={library} onClick={() => setLibrary(!library)}>Anexar referência</button>
        {library && <ReferenceLibrary references={references} urls={urls} canUpload={false} selectable selected={selected}
          onUpload={async () => {}} onSelect={(ids) => { setSelected(ids); setLibrary(false) }} />}
      </>}
      <button type="submit" disabled={blocked || sending}>Enviar</button>
      {sending && <p role="status">Enviando mensagem…</p>}
    </fieldset>
  </form>
}
