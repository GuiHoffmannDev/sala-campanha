// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReferenceLibrary } from '../../packages/desktop/src/ui/ReferenceLibrary.tsx'
import type { Reference } from '../../packages/desktop/src/data/references.ts'

const references: Reference[] = [{
  id: 'reference-1', campaign_id: 'campaign-1', team_id: 'team-1', storage_path: 'team-1/product.png',
  original_name: 'Produto.png', created_at: '2026-11-02T12:00:00Z',
}]

it('uploads valid photos together and names each rejected file with its reason', async () => {
  const user = userEvent.setup({ applyAccept: false })
  const uploaded: File[][] = []
  render(<ReferenceLibrary references={[]} urls={{}} canUpload selectable={false} selected={[]}
    onUpload={async (files) => { uploaded.push(files) }} onSelect={() => {}} />)
  const png = new File(['png'], 'Produto.png', { type: 'image/png' })
  const jpg = new File(['jpg'], 'Detalhe.jpg', { type: 'image/jpeg' })
  const pdf = new File(['pdf'], 'Manual.pdf', { type: 'application/pdf' })
  const large = new File(['png'], 'Grande.png', { type: 'image/png' })
  Object.defineProperty(large, 'size', { value: 26_214_401 })
  const input = screen.getByLabelText('Enviar fotos') as HTMLInputElement
  expect(input.multiple).toBe(true)
  await user.upload(input, [png, pdf, jpg, large])
  await waitFor(() => expect(uploaded).toEqual([[png, jpg]]))
  expect(screen.getByText('Manual.pdf: Use uma imagem PNG, JPG ou WebP.')).toBeTruthy()
  expect(screen.getByText('Grande.png: A imagem tem mais de 25 MB.')).toBeTruthy()
  expect(input.value).toBe('')
})

it('shows thumbnails to an espectador without upload or selection controls', () => {
  render(<ReferenceLibrary references={references} urls={{ 'team-1/product.png': 'https://example.test/product.png' }}
    canUpload={false} selectable={false} selected={[]} onUpload={async () => {}} onSelect={() => {}} />)
  expect(screen.getByRole('img', { name: 'Produto.png' }).getAttribute('src')).toBe('https://example.test/product.png')
  expect(screen.queryByLabelText('Enviar fotos')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Usar selecionadas' })).toBeNull()
})

it('confirms selected reference ids with Usar selecionadas', async () => {
  const user = userEvent.setup()
  const selected: string[][] = []
  render(<ReferenceLibrary references={references} urls={{}} canUpload={false} selectable selected={[]}
    onUpload={async () => {}} onSelect={(ids) => selected.push(ids)} />)
  await user.click(screen.getByRole('checkbox', { name: 'Produto.png' }))
  expect(selected).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Usar selecionadas' }))
  expect(selected).toEqual([['reference-1']])
})

it('shows upload failures and allows another attempt', async () => {
  const user = userEvent.setup()
  let attempts = 0
  render(<ReferenceLibrary references={[]} urls={{}} canUpload selectable={false} selected={[]}
    onUpload={async () => { if (++attempts === 1) throw new Error('Failed to fetch') }} onSelect={() => {}} />)
  const photo = new File(['png'], 'Produto.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('Enviar fotos'), photo)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sem conexão com o servidor. Tente de novo.')
  await user.upload(screen.getByLabelText('Enviar fotos'), photo)
  await waitFor(() => expect(attempts).toBe(2))
  expect(screen.queryByRole('alert')).toBeNull()
})
