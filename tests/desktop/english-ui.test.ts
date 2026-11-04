// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { friendlyError } from '../../packages/desktop/src/data/errors.ts'
import { STATUS_LABELS, KIND_LABELS, DELIVERY_LABELS, EFFORT_LABELS } from '../../packages/desktop/src/lib/labels.ts'
import { timelineItems } from '../../packages/desktop/src/lib/timeline.ts'
import type { SessionEvent } from '../../packages/shared/src/events.ts'
import { LoginScreen } from '../../packages/desktop/src/ui/LoginScreen.tsx'
import { Onboarding } from '../../packages/desktop/src/ui/Onboarding.tsx'
import { CampaignSidebar } from '../../packages/desktop/src/ui/CampaignSidebar.tsx'
import { PieceList } from '../../packages/desktop/src/ui/PieceList.tsx'
import { ReferenceLibrary } from '../../packages/desktop/src/ui/ReferenceLibrary.tsx'
import { Composer } from '../../packages/desktop/src/ui/Composer.tsx'
import { Timeline } from '../../packages/desktop/src/ui/Timeline.tsx'
import { VersionViewer } from '../../packages/desktop/src/ui/VersionViewer.tsx'
import { Settings } from '../../packages/desktop/src/ui/Settings.tsx'

const nothing = async () => {}

it('uses English as the document language', () => {
  const html = readFileSync('packages/desktop/index.html', 'utf8')
  expect(new DOMParser().parseFromString(html, 'text/html').documentElement.lang).toBe('en')
})

it('emails an English sign-in code without changing the token placeholder', () => {
  const html = readFileSync('supabase/templates/codigo.html', 'utf8')
  expect(new DOMParser().parseFromString(html, 'text/html').body.textContent)
    .toBe('Your sign-in code for Sala da Campanha is {{ .Token }}. It is valid for 1 hour.\n')
})
it('central labels and friendly errors are English', () => {
  const cases: [string, string][] = [
    ['piece not found or not writable', 'You cannot edit this piece.'],
    ['message text must not be empty', 'Write a message.'],
    ['piece not found or not approvable', 'Only an admin or manager can approve.'],
    ['version 3 cannot be approved in status acabamento', 'This version cannot be approved at the current stage.'],
    ['only admins and gestores can undo an approval', 'Only an admin or manager can undo an approval.'],
    ['piece has no previous status', 'The piece is already at the first stage.'],
    ['final version needs status acabamento or final_em_revisao', 'The final version can only be uploaded after the base is approved.'],
    ['caption can only be edited on a version under review', 'Only the caption of the version under review can be edited.'],
    ['approved version cannot be edited', 'An approved version cannot be edited.'],
    ['only team admins can set provider keys', 'Only a workspace admin can manage keys.'],
    ['only team admins can delete provider keys', 'Only a workspace admin can manage keys.'],
    ['provider key must have at least 20 characters and no spaces', 'The key must have at least 20 characters and no spaces.'],
    ['only team admins can manage members', 'Only a workspace admin can manage members.'],
    ['only team admins can invite', 'Only a workspace admin can invite people.'],
    ['team needs at least one admin', 'The workspace needs at least one admin.'],
    ['user is already a team member', 'This person is already in the workspace.'],
    ['invalid email', 'Check the email address.'],
    ['workspace name must not be empty', 'Give your workspace a name.'],
    ['display name must not be empty', 'Enter your name.'],
    ['Unsupported provider: provider is not enabled', 'This sign-in method is not available yet.'],
    ['new row violates row-level security policy for table "campaigns"', 'You do not have permission to do this.'],
    ['TypeError: Failed to fetch', 'Cannot connect to the server. Try again.'],
    ['fetch failed', 'Cannot connect to the server. Try again.'],
    ['NetworkError when attempting to fetch resource.', 'Cannot connect to the server. Try again.'],
    // WebKit, the engine of the macOS app, words a network failure this way.
    ['TypeError: Load failed', 'Cannot connect to the server. Try again.'],
  ]
  for (const [server, text] of cases) expect(friendlyError(new Error(server)), server).toBe(text)
})

it('labels every piece stage, kind, delivery state and effort in English', () => {
  expect(STATUS_LABELS).toEqual({ gerando: 'Generating', base_em_revisao: 'Base under review',
    acabamento: 'Finishing', final_em_revisao: 'Final under review', aprovada: 'Approved' })
  expect(KIND_LABELS).toEqual({ imagem: 'Image', texto: 'Text', imagem_texto: 'Image and text' })
  expect(DELIVERY_LABELS).toEqual({ queued: 'queued', claimed: 'the agent is working', failed: 'failed', done: '', not_applicable: '' })
  expect(EFFORT_LABELS).toEqual({ minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'very high', max: 'maximum' })
})

it.each([
  ['missing_key', 'A provider key is missing. Ask your workspace admin to add it.'],
  ['invalid_model', 'The selected model or effort is not available. Choose another option.'],
  ['wrong_status', 'This piece cannot generate base versions at its current stage. Go back one stage to generate again.'],
  ['provider_error', 'The provider rejected the request. Check your provider account and try again.'],
  ['timeout', 'The provider did not respond in time. Try again.'],
  ['invalid_output', 'The provider returned a response the agent could not understand. Try again.'],
  ['internal', 'Internal agent error. Try again.'],
] as const)('renders %s agent errors in English while preserving the event', (code, text) => {
  const event: SessionEvent = { id: 1, team_id: 't', piece_id: 'p', author_id: null, to_agent: false,
    mention_user_ids: [], delivery: 'not_applicable', created_at: '2026-11-04T12:00:00Z', kind: 'agent_error',
    body: { code, message: 'Mensagem antiga do servidor.', message_ids: [1], round: 1, image_prompt: 'Um produto azul' } }
  const original = structuredClone(event)
  expect(timelineItems([event], { members: {}, versions: {}, me: 'me' })[0])
    .toMatchObject({ type: 'agent', text, prompt: 'Um produto azul', error: true })
  expect(event).toEqual(original)
})

it('main flows render only English product copy while preserving Portuguese content', async () => {
  const user = userEvent.setup()
  const login = render(h(LoginScreen, { sendCode: nothing, verifyCode: nothing, startOAuth: nothing }))
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeTruthy()
  expect(screen.getByLabelText('Email')).toBeTruthy()
  login.unmount()

  const onboarding = render(h(Onboarding, { step: 'name', suggestedName: 'João da Conceição', onSaveName: nothing, onCreateWorkspace: nothing }))
  expect(screen.getByLabelText('Your name')).toHaveProperty('value', 'João da Conceição')
  onboarding.unmount()

  const members = [{ userId: 'me', displayName: 'João da Conceição', role: 'admin' as const },
    { userId: 'manager', displayName: 'Gestão', role: 'gestor' as const },
    { userId: 'designer', displayName: 'Criação', role: 'designer' as const },
    { userId: 'viewer', displayName: 'Revisão', role: 'espectador' as const }]
  const piece = { id: 'p', campaign_id: 'c', team_id: 't', title: 'Peça de verão', kind: 'imagem_texto' as const,
    status: 'base_em_revisao' as const, approved_version_id: null, created_at: '2026-11-04T12:00:00Z' }
  const sidebar = render(h(CampaignSidebar, { memberships: [{ teamId: 't', teamName: 'Agência', role: 'admin', displayName: 'João da Conceição' }],
    teamId: 't', campaigns: [{ id: 'c', team_id: 't', name: 'Campanha de verão', created_at: piece.created_at }], pieces: [piece],
    members, route: { campaignId: 'c', pieceId: 'p' }, canWrite: true, onNavigate: () => {}, onSwitchWorkspace: () => {},
    onCreateWorkspace: nothing, onCreateCampaign: nothing, onOpenSettings: () => {} }))
  expect(screen.getByRole('navigation', { name: 'Campaigns' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Campanha de verão' })).toBeTruthy()
  for (const label of ['Admin', 'Manager', 'Designer', 'Viewer']) expect(screen.getByText(label)).toBeTruthy()
  for (const label of ['Light', 'Dark', 'System']) expect(screen.getByLabelText(label)).toBeTruthy()
  sidebar.unmount()

  const list = render(h(PieceList, { pieces: [piece], thumbnails: {}, selectedId: 'p', canWrite: true, onSelect: () => {}, onCreatePiece: nothing }))
  expect(screen.getByRole('region', { name: 'Campaign pieces' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Peça de verãoImage and textBase under review' })).toBeTruthy()
  list.unmount()

  const references = render(h(ReferenceLibrary, { references: [], urls: {}, canUpload: true, selectable: false, selected: [], onUpload: nothing, onSelect: () => {} }))
  expect(screen.getByRole('region', { name: 'Reference library' })).toBeTruthy()
  expect(screen.getByLabelText('Upload photos')).toBeTruthy()
  expect(screen.getByText('No references in this campaign.')).toBeTruthy()
  references.unmount()

  const composer = render(h(Composer, { piece, members: [], keyed: ['openai'], choices: [], references: [], urls: {}, onPost: nothing }))
  expect(screen.getByRole('form', { name: 'Send message' })).toBeTruthy()
  expect(screen.getByLabelText('Message')).toBeTruthy()
  expect(screen.getByLabelText('Text model')).toBeTruthy()
  expect(screen.getByLabelText('Text effort')).toBeTruthy()
  composer.unmount()

  const version = { id: 'v', piece_id: 'p', number: 1, origin: 'agente' as const, phase: 'base' as const,
    image_path: null, caption: 'Promoção de verão', author_id: null, created_at: piece.created_at }
  const timeline = render(h(Timeline, { items: [{ type: 'agent', id: 1, text: 'Version 1', prompt: 'Um produto azul', version, error: false }], imageUrls: {} }))
  expect(screen.getByRole('list', { name: 'Conversation' })).toBeTruthy()
  expect(screen.getByText('Agent')).toBeTruthy()
  expect(screen.getByText('Promoção de verão')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'View prompt' }))
  expect(screen.getByText('Um produto azul')).toBeTruthy()
  timeline.unmount()

  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  const viewer = render(h(VersionViewer, { piece, role: 'gestor', versions: [version], versionId: 'v', approvedIds: new Set<string>(), imageUrls: {},
    onSelectVersion: () => {}, onApprove: nothing, onSaveCaption: nothing, onDownload: nothing, onClose: () => {}, onAddComment: nothing, onSetResolved: nothing }))
  expect(screen.getByRole('dialog', { name: 'Peça de verão — Version 1' })).toBeTruthy()
  expect(screen.getByLabelText('Version caption')).toHaveProperty('value', 'Promoção de verão')
  expect(screen.getByRole('region', { name: 'Version comments' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Comment on version' }))
  expect(screen.getByLabelText('Comment')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Send comment' })).toBeTruthy()
  viewer.unmount()

  render(h(Settings, { teamId: 't', keys: [], members, invites: [{ email: 'nova@example.com', role: 'gestor', created_at: piece.created_at }], me: 'me',
    onSaveKey: nothing, onDeleteKey: nothing, onInvite: nothing, onRevokeInvite: nothing, onSetRole: nothing, onRemove: nothing }))
  expect(screen.getByRole('region', { name: 'Workspace settings' })).toBeTruthy()
  expect(screen.getByLabelText('Key Anthropic')).toBeTruthy()
  await user.click(screen.getByRole('tab', { name: 'Members' }))
  const role = screen.getByLabelText('Role for João da Conceição')
  for (const label of ['Admin', 'Manager', 'Designer', 'Viewer']) expect(within(role).getByRole('option', { name: label })).toBeTruthy()
  expect(screen.getByText('nova@example.com — Manager')).toBeTruthy()
})

it('uses English subjects for both sign-in and sign-up emails', () => {
  const config = readFileSync('supabase/config.toml', 'utf8')
  for (const template of ['magic_link', 'confirmation']) {
    const section = config.split(`[auth.email.template.${template}]`)[1]?.split('\n[')[0]
    expect(section?.match(/^subject = "([^"]+)"/m)?.[1]).toBe('Your Sala da Campanha sign-in code')
  }
})
