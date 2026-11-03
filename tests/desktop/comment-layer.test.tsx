// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Comment } from '../../packages/desktop/src/data/comments.ts'
import { VersionViewer } from '../../packages/desktop/src/ui/VersionViewer.tsx'

const piece = { id: 'p', team_id: 't', campaign_id: 'c', title: 'Banner', kind: 'imagem_texto' as const,
  status: 'base_em_revisao' as const, approved_version_id: null, created_at: '2026-10-28T12:00:00Z' }
const version = { id: 'v1', piece_id: 'p', number: 1, origin: 'agente' as const, phase: 'base' as const,
  image_path: 't/p/image.png', caption: 'Oi 👋 mundo', author_id: null, created_at: piece.created_at }
const root: Comment = { id: 'c1', version_id: 'v1', piece_id: 'p', author_id: 'u', body: 'Logo menor',
  x: 0.25, y: 0.5, text_start: null, text_end: null, quote: null, parent_id: null, resolved: false, created_at: piece.created_at }
const props = { piece, versions: [version, { ...version, id: 'v2', number: 2 }], versionId: 'v1', approvedIds: new Set<string>(),
  imageUrls: { 't/p/image.png': 'https://images.test/one' }, onSelectVersion: () => {}, onApprove: async () => {},
  onSaveCaption: async () => {}, onDownload: async () => {}, onClose: () => {} }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

it('pins the next image click, submits its target and cancels an unfinished pin', async () => {
  const user = userEvent.setup()
  const onAddComment = vi.fn(async () => {})
  render(<VersionViewer {...props} role="designer" comments={[]} onAddComment={onAddComment} onSetResolved={async () => {}} />)
  const image = screen.getByRole('img', { name: 'Banner — Versão 1' })
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 200, height: 100 } as DOMRect)
  await user.click(screen.getByRole('button', { name: 'Comentar na imagem' }))
  fireEvent.click(image, { clientX: 150, clientY: 100, detail: 1 })
  expect(screen.getByRole('button', { name: 'Novo comentário' }).style.left).toBe('25%')
  await user.type(screen.getByLabelText('Comentário'), 'Mover o logo')
  await user.click(screen.getByRole('button', { name: 'Enviar comentário' }))
  expect(onAddComment).toHaveBeenCalledWith({ versionId: 'v1', body: 'Mover o logo', target: { x: 0.25, y: 0.5 }, parentId: null })
  await waitFor(() => expect(screen.queryByLabelText('Comentário')).toBeNull())
  await user.click(screen.getByRole('button', { name: 'Comentar na imagem' }))
  await user.click(screen.getByRole('button', { name: 'Cancelar' }))
  fireEvent.click(image, { clientX: 150, clientY: 100, detail: 1 })
  expect(screen.queryByLabelText('Comentário')).toBeNull()
})

it('uses caption selection with code point offsets and clears an empty selection', async () => {
  const user = userEvent.setup()
  const onAddComment = vi.fn(async () => {})
  render(<VersionViewer {...props} role="designer" comments={[]} onAddComment={onAddComment} onSetResolved={async () => {}} />)
  const caption = screen.getByLabelText('Legenda da versão') as HTMLTextAreaElement
  expect(caption).toHaveProperty('readOnly', true)
  caption.focus()
  caption.setSelectionRange(6, 11)
  fireEvent.select(caption)
  await user.click(screen.getByRole('button', { name: 'Comentar trecho' }))
  await user.type(screen.getByLabelText('Comentário'), 'Trocar palavra')
  await user.click(screen.getByRole('button', { name: 'Enviar comentário' }))
  expect(onAddComment).toHaveBeenCalledWith({ versionId: 'v1', body: 'Trocar palavra',
    target: { text_start: 5, text_end: 10, quote: 'mundo' }, parentId: null })
  caption.setSelectionRange(6, 6)
  fireEvent.select(caption)
  expect(screen.queryByRole('button', { name: 'Comentar trecho' })).toBeNull()
})

it.each([
  { caption: 'Oi\r\n👋 mundo', start: 6, end: 11, textStart: 6, textEnd: 11, quote: 'mundo' },
  { caption: 'Oi\r\n👋 mundo', start: 0, end: 5, textStart: 0, textEnd: 5, quote: 'Oi\r\n👋' },
  { caption: '👋\r\nOi\r\nmundo', start: 6, end: 11, textStart: 7, textEnd: 12, quote: 'mundo' },
  { caption: 'Oi\rmundo', start: 0, end: 8, textStart: 0, textEnd: 8, quote: 'Oi\rmundo' },
])('preserves the original caption when textarea line endings normalize: $caption', async ({ caption: text, start, end, textStart, textEnd, quote }) => {
  const user = userEvent.setup()
  const onAddComment = vi.fn(async () => {})
  render(<VersionViewer {...props} versions={[{ ...version, caption: text }]} role="designer" comments={[]}
    onAddComment={onAddComment} onSetResolved={async () => {}} />)
  const caption = screen.getByLabelText('Legenda da versão') as HTMLTextAreaElement
  expect(caption.value).toBe(text.replace(/\r\n?/g, '\n'))
  caption.focus()
  caption.setSelectionRange(start, end)
  fireEvent.select(caption)
  await user.click(screen.getByRole('button', { name: 'Comentar trecho' }))
  await user.type(screen.getByLabelText('Comentário'), 'Trocar trecho')
  await user.click(screen.getByRole('button', { name: 'Enviar comentário' }))
  expect(onAddComment).toHaveBeenCalledWith({ versionId: 'v1', body: 'Trocar trecho',
    target: { text_start: textStart, text_end: textEnd, quote }, parentId: null })
})

it('disables comment actions while saving the caption and keeps the comment draft', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  render(<VersionViewer {...props} role="designer" comments={[]} onAddComment={async () => {}} onSetResolved={async () => {}}
    onSaveCaption={() => new Promise<void>((resolve) => { finish = resolve })} />)
  await user.click(screen.getByRole('button', { name: 'Comentar na versão' }))
  await user.type(screen.getByLabelText('Comentário'), 'Preservar comentário')
  await user.type(screen.getByLabelText('Legenda'), ' revisada')
  await user.click(screen.getByRole('button', { name: 'Salvar legenda' }))
  expect(screen.getByRole('button', { name: 'Enviar comentário' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Comentar na imagem' })).toHaveProperty('disabled', true)
  finish()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar comentário' })).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('Comentário')).toHaveProperty('value', 'Preservar comentário')
})

it('groups replies under their root, resolves and reopens it, and filters other versions', async () => {
  const user = userEvent.setup()
  function Host() {
    const [comments, setComments] = useState([root, { ...root, id: 'other', version_id: 'v2', body: 'Outra versão' },
      { ...root, id: 'reply', parent_id: 'c1', x: null, y: null, body: 'Combinado' }])
    return <VersionViewer {...props} role="gestor" comments={comments} onAddComment={async ({ body, parentId }) => {
      setComments((current) => [...current, { ...root, id: 'new', x: null, y: null, body, parent_id: parentId }])
    }} onSetResolved={async (id, resolved) => setComments((current) => current.map((c) => c.id === id ? { ...c, resolved } : c))} />
  }
  render(<Host />)
  const thread = screen.getByRole('article', { name: 'Comentário 1' })
  expect(within(thread).getByText('Combinado')).toBeTruthy()
  expect(screen.queryByText('Outra versão')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Comentário 1' }))
  expect(document.activeElement).toBe(thread)
  await user.click(within(thread).getByRole('button', { name: 'Responder' }))
  await user.type(screen.getByLabelText('Comentário'), 'Feito')
  await user.click(screen.getByRole('button', { name: 'Enviar comentário' }))
  expect(await within(thread).findByText('Feito')).toBeTruthy()
  await user.click(within(thread).getByRole('button', { name: 'Resolver' }))
  expect(await within(thread).findByText('Resolvido')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Comentário 1' }).className).toContain('resolved')
  await user.click(within(thread).getByRole('button', { name: 'Reabrir' }))
  expect(await within(thread).findByRole('button', { name: 'Resolver' })).toBeTruthy()
})

it('shows comments read-only to an espectador', () => {
  render(<VersionViewer {...props} role="espectador" comments={[root]} onAddComment={async () => {}} onSetResolved={async () => {}} />)
  expect(screen.getByText('Logo menor')).toBeTruthy()
  for (const name of ['Comentar na imagem', 'Comentar na versão', 'Responder', 'Resolver', 'Reabrir']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
})

it('keeps the comment draft on failure and clears it when navigating to another version', async () => {
  const user = userEvent.setup()
  const callbacks = { onAddComment: async () => { throw new Error('Failed to fetch') }, onSetResolved: async () => {} }
  const { rerender } = render(<VersionViewer {...props} role="designer" comments={[]} {...callbacks} />)
  await user.click(screen.getByRole('button', { name: 'Comentar na versão' }))
  expect(screen.getByRole('button', { name: 'Enviar comentário' })).toHaveProperty('disabled', true)
  await user.type(screen.getByLabelText('Comentário'), 'Não perder')
  await user.click(screen.getByRole('button', { name: 'Enviar comentário' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sem conexão com o servidor. Tente de novo.')
  expect(screen.getByLabelText('Comentário')).toHaveProperty('value', 'Não perder')
  rerender(<VersionViewer {...props} versionId="v2" role="designer" comments={[]} {...callbacks} />)
  expect(screen.queryByLabelText('Comentário')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('allows keyboard users to move the pin and select a point', async () => {
  const user = userEvent.setup()
  const onAddComment = vi.fn(async () => {})
  render(<VersionViewer {...props} role="designer" comments={[]} onAddComment={onAddComment} onSetResolved={async () => {}} />)
  await user.click(screen.getByRole('button', { name: 'Comentar na imagem' }))
  screen.getByRole('button', { name: 'Escolher ponto na imagem' }).focus()
  await user.keyboard('{ArrowRight}{ArrowUp}{Enter}')
  await user.type(screen.getByLabelText('Comentário'), 'Centro')
  await user.click(screen.getByRole('button', { name: 'Enviar comentário' }))
  expect(onAddComment).toHaveBeenCalledWith({ versionId: 'v1', body: 'Centro', target: { x: 0.55, y: 0.45 }, parentId: null })
})

it('disables an unfinished image pin when comment permission is revoked', async () => {
  const user = userEvent.setup()
  const callbacks = { onAddComment: async () => {}, onSetResolved: async () => {} }
  const { rerender } = render(<VersionViewer {...props} role="designer" comments={[]} {...callbacks} />)
  await user.click(screen.getByRole('button', { name: 'Comentar na imagem' }))
  rerender(<VersionViewer {...props} role="espectador" comments={[]} {...callbacks} />)
  expect(screen.getByRole('button', { name: 'Escolher ponto na imagem' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
})
