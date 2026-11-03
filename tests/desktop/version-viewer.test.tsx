// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Piece } from '../../packages/desktop/src/data/campaigns.ts'
import type { Version } from '../../packages/desktop/src/data/versions.ts'
import { VersionViewer } from '../../packages/desktop/src/ui/VersionViewer.tsx'
import { UploadFinalDialog } from '../../packages/desktop/src/ui/UploadFinalDialog.tsx'
import { PieceHeader } from '../../packages/desktop/src/ui/PieceHeader.tsx'

const piece: Piece = { id: 'p', team_id: 't', campaign_id: 'c', title: 'Banner', kind: 'imagem_texto',
  status: 'base_em_revisao', approved_version_id: null, created_at: '2026-10-28T12:00:00Z' }
const versions: Version[] = [1, 2].map((number) => ({
  id: `v${number}`, piece_id: 'p', number, origin: 'agente', phase: 'base', image_path: `t/p/v${number}.png`,
  caption: `Legenda ${number}`, author_id: null, created_at: piece.created_at,
}))

// jsdom has no native modal API. The browser supplies focus trapping and Escape handling.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

it('opens a modal, browses versions, downloads the image and approves the selected version', async () => {
  const user = userEvent.setup()
  const onApprove = vi.fn(async () => {})
  const onDownload = vi.fn(async () => {})
  const onClose = vi.fn()
  function Host() {
    const [versionId, select] = useState('v1')
    return <VersionViewer piece={piece} role="gestor" versions={versions} versionId={versionId}
      approvedIds={new Set()} imageUrls={{ 't/p/v1.png': 'https://images.test/one', 't/p/v2.png': 'https://images.test/two' }}
      onSelectVersion={select} onApprove={onApprove} onDownload={onDownload}
      onSaveCaption={async () => {}} onClose={onClose} />
  }
  render(<Host />)
  const dialog = screen.getByRole('dialog', { name: 'Banner — Versão 1' })
  expect(within(dialog).getByRole('img', { name: 'Banner — Versão 1' }).getAttribute('src')).toBe('https://images.test/one')
  expect(screen.getByRole('button', { name: 'Versão anterior' })).toHaveProperty('disabled', true)
  await user.click(screen.getByRole('button', { name: 'Próxima versão' }))
  expect(screen.getByRole('dialog', { name: 'Banner — Versão 2' })).toBeTruthy()
  expect(screen.getByLabelText('Legenda')).toHaveProperty('value', 'Legenda 2')
  expect(screen.getByRole('button', { name: 'Próxima versão' })).toHaveProperty('disabled', true)
  await user.click(screen.getByRole('button', { name: 'Baixar' }))
  expect(onDownload).toHaveBeenCalledWith(versions[1])
  await user.click(screen.getByRole('button', { name: 'Aprovar esta versão' }))
  expect(onApprove).toHaveBeenCalledWith('v2')
  await user.click(screen.getByRole('button', { name: 'Fechar' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it.each(['imagem', 'texto', 'imagem_texto'] as const)('uploads the final package for %s with the approved caption', async (kind) => {
  const user = userEvent.setup()
  const onUpload = vi.fn(async () => {})
  const onClose = vi.fn()
  render(<UploadFinalDialog piece={{ ...piece, kind }} initialCaption="Legenda aprovada" onUpload={onUpload} onClose={onClose} />)
  expect(screen.getByRole('dialog', { name: 'Enviar versão final' })).toBeTruthy()
  const image = new File(['png'], 'Final.png', { type: 'image/png' })
  if (kind !== 'texto') {
    const input = screen.getByLabelText('Imagem final')
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp')
    await user.upload(input, image)
  } else expect(screen.queryByLabelText('Imagem final')).toBeNull()
  if (kind !== 'imagem') {
    expect(screen.getByLabelText('Legenda final')).toHaveProperty('value', 'Legenda aprovada')
    await user.clear(screen.getByLabelText('Legenda final'))
    await user.type(screen.getByLabelText('Legenda final'), 'Legenda final revisada')
  } else expect(screen.queryByLabelText('Legenda final')).toBeNull()
  // jsdom's native required-file check does not see user-event's synthetic FileList.
  fireEvent.submit(screen.getByRole('button', { name: 'Enviar versão final' }).closest('form')!)
  await waitFor(() => expect(onUpload).toHaveBeenCalledWith(kind === 'texto' ? null : image, kind === 'imagem' ? null : 'Legenda final revisada'))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
})

it('confirms the previous status, including the shorter text lifecycle, and offers final upload only to writers', async () => {
  const user = userEvent.setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const onStepBack = vi.fn(async () => {})
  const onUploadFinal = vi.fn()
  const props = { campaign: { id: 'c', team_id: 't', name: 'Campanha', created_at: piece.created_at }, canWrite: true,
    onRename: async () => {}, onStepBack, onUploadFinal }
  const { rerender } = render(<PieceHeader {...props} role="designer" piece={{ ...piece, status: 'acabamento' }} />)
  await user.click(screen.getByRole('button', { name: 'Voltar uma etapa' }))
  expect(confirm).toHaveBeenCalledWith('Voltar a peça de Acabamento para Base em revisão?')
  expect(onStepBack).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'Voltar uma etapa' }))
  expect(onStepBack).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'Enviar versão final' }))
  expect(onUploadFinal).toHaveBeenCalledOnce()
  rerender(<PieceHeader {...props} role="gestor" piece={{ ...piece, kind: 'texto', status: 'aprovada' }} />)
  await user.click(screen.getByRole('button', { name: 'Voltar uma etapa' }))
  expect(confirm).toHaveBeenLastCalledWith('Voltar a peça de Aprovada para Base em revisão?')
  rerender(<PieceHeader {...props} role="espectador" canWrite={false} piece={{ ...piece, status: 'final_em_revisao' }} />)
  expect(screen.queryByRole('button', { name: 'Voltar uma etapa' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Enviar versão final' })).toBeNull()
  confirm.mockRestore()
})

it('locks approved captions and hides every write action from an espectador', () => {
  const props = { piece, versions, versionId: 'v1', approvedIds: new Set(['v1']), imageUrls: {},
    onSelectVersion: () => {}, onApprove: async () => {}, onSaveCaption: async () => {}, onDownload: async () => {}, onClose: () => {} }
  const { rerender } = render(<VersionViewer {...props} role="designer" />)
  expect(screen.getByText('Legenda 1')).toBeTruthy()
  expect(screen.queryByLabelText('Legenda')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Aprovar esta versão' })).toBeNull()
  rerender(<VersionViewer {...props} role="espectador" approvedIds={new Set()} />)
  expect(screen.queryByLabelText('Legenda')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Salvar legenda' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Aprovar esta versão' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy()
})

it('keeps the draft after a failed save and never approves an unsaved caption', async () => {
  const user = userEvent.setup()
  const onSaveCaption = vi.fn(async () => { throw new Error('Failed to fetch') })
  const onApprove = vi.fn(async () => {})
  render(<VersionViewer piece={piece} role="gestor" versions={versions} versionId="v1" approvedIds={new Set()} imageUrls={{}}
    onSelectVersion={() => {}} onApprove={onApprove} onSaveCaption={onSaveCaption} onDownload={async () => {}} onClose={() => {}} />)
  await user.clear(screen.getByLabelText('Legenda'))
  await user.type(screen.getByLabelText('Legenda'), 'Texto corrigido')
  expect(screen.getByRole('button', { name: 'Aprovar esta versão' })).toHaveProperty('disabled', true)
  await user.click(screen.getByRole('button', { name: 'Salvar legenda' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sem conexão com o servidor. Tente de novo.')
  expect(screen.getByLabelText('Legenda')).toHaveProperty('value', 'Texto corrigido')
  expect(onSaveCaption).toHaveBeenCalledWith('v1', 'Texto corrigido')
  expect(onApprove).not.toHaveBeenCalled()
})

it('rejects invalid image files and shows friendly upload errors without closing the modal', async () => {
  const onUpload = vi.fn(async () => { throw new Error('Failed to fetch') })
  const onClose = vi.fn()
  render(<UploadFinalDialog piece={piece} initialCaption="Legenda" onUpload={onUpload} onClose={onClose} />)
  const input = screen.getByLabelText('Imagem final')
  const form = screen.getByRole('button', { name: 'Enviar versão final' }).closest('form')!
  for (const file of [new File(['pdf'], 'Manual.pdf', { type: 'application/pdf' }),
    { type: 'image/png', size: 26_214_401 }]) {
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', file.type === 'application/pdf'
      ? 'Use uma imagem PNG, JPG ou WebP.' : 'A imagem tem mais de 25 MB.')
  }
  expect(onUpload).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { files: [new File(['png'], 'Final.png', { type: 'image/png' })] } })
  fireEvent.submit(form)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sem conexão com o servidor. Tente de novo.')
  expect(onClose).not.toHaveBeenCalled()
})
