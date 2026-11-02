import { useState } from 'react'
import { DELIVERY_LABELS } from '../lib/labels.ts'
import { initials, type TimelineItem } from '../lib/timeline.ts'

type Props = {
  items: TimelineItem[]
  /** Signed URL by `image_path`. */
  imageUrls: Record<string, string>
  /** Runs when an agent image finishes loading: it grows the list after the render. */
  onImageLoad?: () => void
}

/** The piece conversation, oldest first. */
export function Timeline({ items, imageUrls, onImageLoad }: Props) {
  return (
    <ol className="timeline" aria-label="Conversa">
      {items.map((item) => {
        if (item.type === 'message') {
          const delivery = item.deliveryLabel === DELIVERY_LABELS.failed ? 'delivery-failed' : 'delivery-pending'
          return (
            <li key={item.id} className={item.mine ? 'chat-message mine' : 'chat-message'}>
              <span className="avatar" aria-hidden="true">{initials(item.author)}</span>
              <div className="chat-bubble">
                <strong className="chat-author">{item.author}</strong>
                <p>{item.text}</p>
                {item.deliveryLabel && <span className={`delivery ${delivery}`}>{item.deliveryLabel}</span>}
              </div>
            </li>
          )
        }
        if (item.type === 'agent') return <AgentCard key={item.id} item={item} imageUrls={imageUrls} onImageLoad={onImageLoad} />
        return <li key={item.id} className="chat-system">{item.text}</li>
      })}
    </ol>
  )
}

function AgentCard({ item, imageUrls, onImageLoad }: {
  item: Extract<TimelineItem, { type: 'agent' }>; imageUrls: Record<string, string>; onImageLoad?: () => void
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  const url = item.version?.image_path ? imageUrls[item.version.image_path] : undefined
  return (
    <li className={item.error ? 'agent-card agent-error' : 'agent-card'}>
      <strong className="chat-author">Agente</strong>
      <p className={item.error ? 'agent-error-text' : 'agent-title'}>{item.text}</p>
      {url && <img src={url} alt={item.text} onLoad={onImageLoad} />}
      {item.version?.caption && <p className="agent-caption">{item.version.caption}</p>}
      {item.prompt && (
        <>
          <button type="button" aria-expanded={showPrompt} onClick={() => setShowPrompt((s) => !s)}>Ver prompt</button>
          {showPrompt && <pre className="agent-prompt">{item.prompt}</pre>}
        </>
      )}
    </li>
  )
}
