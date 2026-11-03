// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { File as NodeFile } from 'node:buffer'
import { Shell } from '../../packages/desktop/src/ui/Shell.tsx'
import { loadVersions } from '../../packages/desktop/src/data/versions.ts'
import { createAgentVersion, createPieceFixture, serviceClient, TEST_EXECUTOR } from '../helpers/supabase'

const opened = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock('../../packages/desktop/src/native.ts', () => ({ copyText: async () => {}, openExternal: async (url: string) => { opened.urls.push(url) } }))
// Exercise explicit refresh after writes without relying on a live WebSocket in jsdom.
vi.mock('../../packages/desktop/src/data/events.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/events.ts')>()), subscribePiece: () => () => {},
  subscribeMentions: () => () => {},
}))
// Presence sockets are exercised against the real server in presence.test.ts.
vi.mock('../../packages/desktop/src/data/presence.ts', () => ({
  joinTeamPresence: async () => ({ setPiece: async () => {}, leave: async () => {} }),
}))

vi.mock('../../packages/desktop/src/data/campaigns.ts', async (original) => ({
  ...(await original<typeof import('../../packages/desktop/src/data/campaigns.ts')>()), subscribeLists: () => () => {},
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

it('edits and approves the base, uploads its final, downloads and approves it, then steps back without Realtime', async () => {
  const user = userEvent.setup()
  const f = await createPieceFixture()
  const client = f.t.members.gestor.client
  const base = await createAgentVersion(f)
  const { error } = await serviceClient().rpc('add_agent_event', {
    p_source_event: base.source_event_id, p_executor: TEST_EXECUTOR, p_kind: 'agent_result',
    p_body: { message_ids: [base.source_event_id], round: 1, version_id: base.id, version_number: 1, image_prompt: null },
  })
  expect(error).toBeNull()
  render(<Shell client={client} memberships={[{ teamId: f.t.teamId, teamName: 'Estúdio', role: 'gestor', displayName: 'Gil' }]}
    teamId={f.t.teamId} route={{ campaignId: f.campaignId, pieceId: f.pieceId }} onNavigate={() => {}}
    onSwitchWorkspace={() => {}} onCreateWorkspace={async () => {}} />)

  await user.click(await screen.findByRole('button', { name: 'Abrir versão 1' }))
  await user.clear(screen.getByLabelText('Legenda'))
  await user.type(screen.getByLabelText('Legenda'), 'Legenda aprovada revisada')
  await user.click(screen.getByRole('button', { name: 'Salvar legenda' }))
  expect(await screen.findByRole('dialog', { name: 'Peça de teste — Versão 2' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Aprovar esta versão' }))
  const header = screen.getByRole('banner')
  expect(await within(header).findByText('Acabamento')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Fechar' }))

  await user.click(screen.getByRole('button', { name: 'Enviar versão final' }))
  const upload = screen.getByRole('dialog', { name: 'Enviar versão final' })
  expect(within(upload).getByLabelText('Legenda final')).toHaveProperty('value', 'Legenda aprovada revisada')
  fireEvent.change(within(upload).getByLabelText('Imagem final'), {
    target: { files: [new NodeFile(['png'], 'Final.png', { type: 'image/png' })] },
  })
  fireEvent.submit(within(upload).getByRole('button', { name: 'Enviar versão final' }).closest('form')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await within(header).findByText('Final em revisão')).toBeTruthy()
  await user.click(await screen.findByRole('button', { name: 'Abrir versão 3' }))
  await user.click(screen.getByRole('button', { name: 'Baixar' }))
  await waitFor(() => expect(opened.urls).toHaveLength(1))
  const download = new URL(opened.urls[0]!)
  expect(download.pathname).toContain('/storage/v1/object/sign/team-files/')
  const response = await fetch(download)
  expect(response.status).toBe(200)
  const disposition = response.headers.get('content-disposition')!
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  const filename = utf8 ? decodeURIComponent(utf8[1]!) : /filename="([^"]+)"/.exec(disposition)?.[1]
  expect(filename).toBe('Peça de teste v3.png')
  await user.click(screen.getByRole('button', { name: 'Aprovar esta versão' }))
  expect(await within(header).findByText('Aprovada')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Fechar' }))

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'Voltar uma etapa' }))
  expect(confirm).toHaveBeenCalledWith('Voltar a peça de Aprovada para Final em revisão?')
  expect(await within(header).findByText('Final em revisão')).toBeTruthy()
  confirm.mockRestore()
  await user.click(screen.getAllByRole('button', { name: 'Abrir versão 3' })[0]!)
  expect(screen.queryByLabelText('Legenda')).toBeNull()
  expect(screen.getByRole('button', { name: 'Aprovar esta versão' })).toBeTruthy()
  expect((await loadVersions(client, f.pieceId)).map((v) => v.origin)).toEqual(['agente', 'edicao', 'upload'])
})
