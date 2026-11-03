import { useId, useRef, useState } from 'react'
import type { Comment, CommentTarget, NewComment } from '../data/comments.ts'
import { friendlyError } from '../data/errors.ts'
import type { Version } from '../data/versions.ts'
import { captionExcerpt, pointFromClick } from '../lib/excerpt.ts'

type Props = {
  version: Version
  title: string
  imageUrl?: string
  comments: Comment[]
  canComment: boolean
  busy: boolean
  onAdd?(input: NewComment): Promise<void>
  onSetResolved?(id: string, resolved: boolean): Promise<void>
  onBusyChange(busy: boolean): void
}

export function CommentLayer({ version, title, imageUrl, comments, canComment, busy, onAdd, onSetResolved, onBusyChange }: Props) {
  const prefix = useId()
  const image = useRef<HTMLImageElement>(null)
  const caption = useRef<HTMLTextAreaElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const [pinning, setPinning] = useState(false)
  const [point, setPoint] = useState({ x: 0.5, y: 0.5 })
  const [excerpt, setExcerpt] = useState<ReturnType<typeof captionExcerpt>>(null)
  const [draft, setDraft] = useState<{ target: CommentTarget; parentId: string | null } | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const current = comments.filter((c) => c.version_id === version.id)
  const roots = current.filter((c) => c.parent_id === null)

  function start(target: CommentTarget, parentId: string | null = null) {
    setDraft({ target, parentId })
    setBody('')
    setPinning(false)
    setExcerpt(null)
    setError(null)
  }

  function selectExcerpt() {
    if (!canComment || !caption.current) return
    setExcerpt(captionExcerpt(version.caption ?? '', caption.current.selectionStart, caption.current.selectionEnd))
  }

  async function run(action: () => Promise<void>) {
    onBusyChange(true)
    setError(null)
    try { await action() } catch (e) { setError(friendlyError(e)) } finally { onBusyChange(false) }
  }

  function focusThread(id: string) {
    document.getElementById(`${prefix}-${id}`)?.focus()
  }

  return <>
    {version.image_path && (imageUrl
      ? <div className="comment-image">
        <button type="button" className="comment-image-target" aria-label="Escolher ponto na imagem"
          disabled={!canComment || !pinning || busy} onKeyDown={(e) => {
            const move = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[e.key]
            if (!move) return
            e.preventDefault()
            setPoint((p) => pointFromClick({ left: 0, top: 0, width: 1, height: 1 }, p.x + move[0]!, p.y + move[1]!))
          }} onClick={(e) => {
            if (!canComment || !pinning || !image.current) return
            start(e.detail === 0 ? point : pointFromClick(image.current.getBoundingClientRect(), e.clientX, e.clientY))
          }}>
          <img ref={image} className="version-image" src={imageUrl} alt={title} />
        </button>
        {pinning && canComment && <span className="comment-pin" aria-hidden="true"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>+</span>}
        {roots.map((c, index) => c.x !== null && c.y !== null && <button key={c.id} type="button"
          className={`comment-pin${c.resolved ? ' resolved' : ''}`} aria-label={`Comentário ${index + 1}`}
          aria-controls={`${prefix}-${c.id}`} style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          onClick={() => focusThread(c.id)}>{index + 1}</button>)}
        {canComment && draft?.target && 'x' in draft.target && <button type="button" className="comment-pin"
          aria-label="Novo comentário" style={{ left: `${draft.target.x * 100}%`, top: `${draft.target.y * 100}%` }}
          onClick={() => field.current?.focus()}>+</button>}
      </div>
      : <p role="status">Imagem indisponível.</p>)}
    {version.caption !== null && <textarea ref={caption} className="version-caption" aria-label="Legenda da versão"
      readOnly value={version.caption} onSelect={selectExcerpt} />}
    <section aria-label="Comentários da versão" className="comment-layer">
      {canComment && <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={() => start(null)}>Comentar na versão</button>
        {imageUrl && <button type="button" disabled={busy} aria-pressed={pinning}
          onClick={() => { setPinning(true); setPoint({ x: 0.5, y: 0.5 }); setDraft(null); setError(null) }}>Comentar na imagem</button>}
        {excerpt && <button type="button" disabled={busy} onClick={() => start(excerpt)}>Comentar trecho</button>}
      </div>}
      {pinning && canComment && <p role="status">Clique na imagem. Pelo teclado, use as setas e Enter.
        {' '}Ponto: {Math.round(point.x * 100)}%, {Math.round(point.y * 100)}%.
        {' '}<button type="button" onClick={() => setPinning(false)}>Cancelar</button></p>}
      {draft && canComment && <form onSubmit={(e) => {
        e.preventDefault()
        if (busy || !body.trim() || !onAdd) return
        void run(async () => {
          await onAdd({ versionId: version.id, body, ...draft })
          setDraft(null)
          setBody('')
        })
      }}>
        {draft.target && 'quote' in draft.target && <blockquote>{draft.target.quote}</blockquote>}
        <label>Comentário<textarea ref={field} value={body} onChange={(e) => setBody(e.target.value)} required disabled={busy} /></label>
        <div className="dialog-actions">
          <button type="submit" disabled={busy || !body.trim()}>Enviar comentário</button>
          <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(null) }}>Cancelar</button>
        </div>
      </form>}
      {error && <p role="alert">{error}</p>}
      {roots.map((root, index) => <article key={root.id} id={`${prefix}-${root.id}`} tabIndex={-1}
        aria-label={`Comentário ${index + 1}`} className="comment-thread">
        <strong>Comentário {index + 1}</strong>
        {root.quote && <blockquote>{root.quote}</blockquote>}
        <p>{root.body}</p>
        {root.resolved && <span className="comment-resolved">Resolvido</span>}
        {current.filter((c) => c.parent_id === root.id).map((reply) => <p key={reply.id} className="comment-reply">{reply.body}</p>)}
        {canComment && <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => start(null, root.id)}>Responder</button>
          <button type="button" disabled={busy} onClick={() => void run(() => onSetResolved!(root.id, !root.resolved))}>
            {root.resolved ? 'Reabrir' : 'Resolver'}
          </button>
        </div>}
      </article>)}
    </section>
  </>
}
