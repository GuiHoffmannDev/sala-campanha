import { PIECE_KINDS, PIECE_STATUSES, ROLES, VERSION_PHASES } from '../../packages/shared/src/domain.ts'
import { parseEvent } from '../../packages/shared/src/events.ts'
import { approvedVersionIds, pieceActions } from '../../packages/desktop/src/lib/actions.ts'

it('pieceActions follows the permission table', () => {
  for (const role of ROLES) for (const status of PIECE_STATUSES) for (const kind of PIECE_KINDS) {
    for (const phase of VERSION_PHASES) for (const approved of [false, true]) {
      const writer = role !== 'espectador'
      const manager = role === 'admin' || role === 'gestor'
      const reviewing = `${status}:${phase}` === 'base_em_revisao:base' || `${status}:${phase}` === 'final_em_revisao:final'
      expect(pieceActions(role, { kind, status }, { phase, approved }), `${role}/${status}/${kind}/${phase}/${approved}`)
        .toEqual({
          approve: manager && reviewing,
          stepBack: writer && status !== 'gerando' && (status !== 'aprovada' || manager),
          uploadFinal: writer && ['acabamento', 'final_em_revisao'].includes(status),
          editCaption: writer && kind !== 'imagem' && reviewing && !approved,
          comment: writer,
          chat: writer,
        })
    }
    expect(pieceActions(role, { kind, status }, null)).toMatchObject({ approve: false, editCaption: false })
  }
})

it('keeps every historically approved version locked, even after a step back', () => {
  const row = { id: 1, piece_id: 'piece', team_id: 'team', author_id: 'gestor', to_agent: false,
    mention_user_ids: [], delivery: 'not_applicable', created_at: '2026-10-28T12:00:00Z' }
  const events = [
    parseEvent({ ...row, kind: 'approval', body: { version_id: 'base', from: 'base_em_revisao', to: 'acabamento' } })!,
    parseEvent({ ...row, id: 2, kind: 'approval', body: { version_id: 'final', from: 'final_em_revisao', to: 'aprovada' } })!,
    parseEvent({ ...row, id: 3, kind: 'status_changed', body: { from: 'aprovada', to: 'final_em_revisao' } })!,
  ]
  expect(approvedVersionIds(events)).toEqual(new Set(['base', 'final']))
  expect(approvedVersionIds([])).toEqual(new Set())
})
