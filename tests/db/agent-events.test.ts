import { createClaimedMessage, createPieceFixture, serviceClient, TEST_EXECUTOR } from '../helpers/supabase'

function addAgentEvent(sourceEvent: number, kind: string, body: unknown, executor = TEST_EXECUTOR) {
  return serviceClient().rpc('add_agent_event', {
    p_source_event: sourceEvent, p_executor: executor, p_kind: kind, p_body: body,
  })
}

it('executor adds agent event on its claimed message', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  const { data, error } = await addAgentEvent(src, 'agent_started', { message_ids: [src] })
  expect(error).toBeNull()
  expect(data).toMatchObject({
    piece_id: f.pieceId, team_id: f.t.teamId, kind: 'agent_started', body: { message_ids: [src] },
    author_id: null, to_agent: false, delivery: 'not_applicable',
  })
})

it('accepts every agent event kind', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  for (const kind of ['agent_started', 'agent_result', 'agent_error']) {
    expect((await addAgentEvent(src, kind, {})).error).toBeNull()
  }
})

it('rejects other executor', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  const { error } = await addAgentEvent(src, 'agent_started', {}, 'other-executor')
  expect(error?.code).toBe('42501')
})

it('rejects a message that is no longer claimed', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  await serviceClient().rpc('complete_message', { p_event: src, p_executor: TEST_EXECUTOR, p_status: 'done' })
  const { error } = await addAgentEvent(src, 'agent_result', {})
  expect(error?.code).toBe('42501')
})

it('rejects non-agent kinds', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  for (const kind of ['approval', 'user_message', 'comment']) {
    expect((await addAgentEvent(src, kind, {})).error?.code).toBe('22023')
  }
})

it('rejects non-object body', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  for (const body of [[], 'text', 1, null]) {
    expect((await addAgentEvent(src, 'agent_started', body)).error?.code).toBe('22023')
  }
})

it('authenticated cannot call add_agent_event', async () => {
  const f = await createPieceFixture()
  const src = await createClaimedMessage(f)
  const { error } = await f.t.members.admin.client.rpc('add_agent_event', {
    p_source_event: src, p_executor: TEST_EXECUTOR, p_kind: 'agent_started', p_body: {},
  })
  expect(error).not.toBeNull()
})

it('members of the team see the agent event; other team does not', async () => {
  const a = await createPieceFixture()
  const b = await createPieceFixture()
  const src = await createClaimedMessage(a)
  const { data: event } = await addAgentEvent(src, 'agent_result', { version_id: null })
  const { data: seen } = await a.t.members.espectador.client.from('session_events').select('id').eq('id', event!.id)
  expect(seen).toEqual([{ id: event!.id }])
  const { data: hidden } = await b.t.members.admin.client.from('session_events').select('id').eq('id', event!.id)
  expect(hidden).toEqual([])
})
