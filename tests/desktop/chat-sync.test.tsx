// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Piece } from '../../packages/desktop/src/data/campaigns.ts'
import type { PieceHandlers } from '../../packages/desktop/src/data/events.ts'
import { loadVersions, uploadFinalVersion, type Version } from '../../packages/desktop/src/data/versions.ts'
import { Chat } from '../../packages/desktop/src/ui/Chat.tsx'
import { PieceHeader } from '../../packages/desktop/src/ui/PieceHeader.tsx'

const live = vi.hoisted(() => ({ handlers: null as PieceHandlers | null }))
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/events.ts')>()),
  loadEvents: async () => [],
  subscribePiece: (_client: unknown, _pieceId: string, handlers: PieceHandlers) => {
    live.handlers = handlers
    return () => {}
  },
}))
vi.mock('../../packages/desktop/src/data/versions.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/versions.ts')>()),
  loadVersions: vi.fn(), uploadFinalVersion: vi.fn(),
}))
vi.mock('../../packages/desktop/src/data/files.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/files.ts')>()),
  signedUrls: async () => ({}),
}))
vi.mock('../../packages/desktop/src/data/keys.ts', () => ({ loadKeyedProviders: async () => [] }))
vi.mock('../../packages/desktop/src/data/references.ts', () => ({ loadReferences: async () => [] }))
vi.mock('../../packages/desktop/src/native.ts', () => ({ copyText: async () => {} }))

const piece: Piece = { id: 'p', team_id: 't', campaign_id: 'c', title: 'Banner', kind: 'imagem_texto',
  status: 'base_em_revisao', approved_version_id: null, created_at: '2026-10-28T12:00:00Z' }
const base: Version = { id: 'v1', piece_id: piece.id, number: 1, origin: 'agente', phase: 'base',
  image_path: 't/p/base.png', caption: 'Legenda base', author_id: null, created_at: piece.created_at }
const props = { client: { auth: { getSession: async () => ({ data: { session: null } }) } } as unknown as SupabaseClient,
  piece, role: 'designer' as const, members: [], onCloseUpload: () => {} }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

beforeEach(() => {
  vi.mocked(loadVersions).mockReset().mockResolvedValue([base])
  vi.mocked(uploadFinalVersion).mockReset().mockResolvedValue({ ...base, phase: 'final', origin: 'upload' })
})

it('refreshes the header after approvals and step backs missed while disconnected', async () => {
  let remotePiece = piece
  function Host() {
    const [current, setPiece] = useState(piece)
    const reload = useCallback(() => setPiece(remotePiece), [])
    return <>
      <PieceHeader campaign={{ id: 'c', team_id: 't', name: 'Campanha', created_at: piece.created_at }}
        piece={current} role="designer" canWrite onRename={async () => {}} onStepBack={async () => {}} onUploadFinal={() => {}} />
      <Chat {...props} piece={current} onChange={reload} />
    </>
  }
  render(<Host />)
  await act(async () => live.handlers!.onSubscribed())
  expect(screen.queryByRole('button', { name: 'Enviar versão final' })).toBeNull()

  remotePiece = { ...piece, status: 'acabamento', approved_version_id: base.id }
  await act(async () => live.handlers!.onSubscribed())
  expect(screen.getByRole('banner').textContent).toContain('Acabamento')
  expect(screen.getByRole('button', { name: 'Enviar versão final' })).toBeTruthy()

  remotePiece = piece
  await act(async () => live.handlers!.onSubscribed())
  expect(screen.getByRole('banner').textContent).toContain('Base em revisão')
  expect(screen.queryByRole('button', { name: 'Enviar versão final' })).toBeNull()
})

it('waits for the approved base before opening the final upload with its caption', async () => {
  const { rerender } = render(<Chat {...props} />)
  await act(async () => {})
  const approved = { ...base, id: 'v2', number: 2, origin: 'edicao' as const, caption: 'Legenda aprovada' }
  let resolveVersions!: (versions: Version[]) => void
  vi.mocked(loadVersions).mockImplementationOnce(() => new Promise((resolve) => { resolveVersions = resolve }))
  rerender(<Chat {...props} piece={{ ...piece, status: 'acabamento', approved_version_id: approved.id }} uploadFinalOpen />)

  expect(screen.queryByRole('dialog', { name: 'Enviar versão final' })).toBeNull()
  await act(async () => resolveVersions([base, approved]))
  expect(screen.getByLabelText('Legenda final')).toHaveProperty('value', 'Legenda aprovada')
})

it('keeps the selected file and caption draft while versions reload', async () => {
  render(<Chat {...props} piece={{ ...piece, status: 'acabamento', approved_version_id: base.id }} uploadFinalOpen />)
  const caption = await screen.findByLabelText('Legenda final')
  const dialog = screen.getByRole('dialog', { name: 'Enviar versão final' })
  const file = new File(['png'], 'Final.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Imagem final'), { target: { files: [file] } })
  fireEvent.change(caption, { target: { value: 'Legenda final revisada' } })

  let resolveVersions!: (versions: Version[]) => void
  vi.mocked(loadVersions).mockImplementationOnce(() => new Promise((resolve) => { resolveVersions = resolve }))
  await act(async () => live.handlers!.onVersion())
  expect(screen.getByRole('dialog', { name: 'Enviar versão final' })).toBe(dialog)
  await act(async () => resolveVersions([base]))
  expect(screen.getByRole('dialog', { name: 'Enviar versão final' })).toBe(dialog)
  expect(caption).toHaveProperty('value', 'Legenda final revisada')

  fireEvent.submit(screen.getByRole('button', { name: 'Enviar versão final' }).closest('form')!)
  await waitFor(() => expect(uploadFinalVersion).toHaveBeenCalledWith(props.client, {
    piece: { ...piece, status: 'acabamento', approved_version_id: base.id }, file, caption: 'Legenda final revisada',
  }))
})
