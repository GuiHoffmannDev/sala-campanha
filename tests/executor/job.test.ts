import { randomUUID } from 'node:crypto'
import { findModel } from '../../packages/shared/src/agent.ts'
import type { Provider } from '../../packages/shared/src/domain'
import { createExecutorDb, type ExecutorDb } from '../../packages/executor/src/db.ts'
import { processClaim, resolveModels, type JobDeps } from '../../packages/executor/src/job.ts'
import { createLogger } from '../../packages/executor/src/log.ts'
import { ProviderError, type GeneratedImage } from '../../packages/executor/src/providers/types.ts'
import { FAKE_IMAGE, fakeProviders } from '../helpers/fake-providers'
import {
  createAgentVersion, createClaimedMessage, createPieceFixture, loadEvent, serviceClient, TEST_EXECUTOR,
  type PieceFixture, type PieceKind,
} from '../helpers/supabase'

const KEYS: Record<Provider, string> = {
  anthropic: 'sk-ant-job-test-1234567890abcdef',
  openai: 'sk-openai-job-test-1234567890abcdef',
  gemini: 'gemini-job-test-1234567890abcdef',
  fal: 'fal-job-test-1234567890abcdef',
  krea: 'krea-job-test-1234567890abcdef',
}

async function setKeys(f: PieceFixture, providers: Provider[]) {
  for (const p of providers) {
    const { error } = await f.t.members.admin.client.rpc('set_provider_key', { p_team: f.t.teamId, p_provider: p, p_key: KEYS[p] })
    expect(error).toBeNull()
  }
}

type Setup = { f: PieceFixture; db: ExecutorDb; lines: string[]; deps: (p: ReturnType<typeof fakeProviders>, o?: Partial<JobDeps>) => JobDeps }

async function setup(kind: PieceKind = 'imagem_texto', keys: Provider[] = ['anthropic', 'gemini']): Promise<Setup> {
  const f = await createPieceFixture(undefined, kind)
  await setKeys(f, keys)
  const db = createExecutorDb(serviceClient(), TEST_EXECUTOR)
  const lines: string[] = []
  const log = createLogger((line) => lines.push(line))
  return {
    f, db, lines,
    deps: (p, o = {}) => ({ db, providers: p.providers, log, touchIntervalMs: 60_000, textTimeoutMs: 5_000, imageTimeoutMs: 5_000, ...o }),
  }
}

async function eventsAfter(f: PieceFixture, afterId: number): Promise<{ id: number; kind: string; body: Record<string, unknown> }[]> {
  const { data, error } = await serviceClient().from('session_events').select('id, kind, body')
    .eq('piece_id', f.pieceId).gt('id', afterId).order('id')
  if (error) throw new Error(error.message)
  return data
}

async function delivery(id: number): Promise<string> {
  const { data, error } = await serviceClient().from('session_events').select('delivery').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data.delivery
}

async function versions(f: PieceFixture) {
  const { data, error } = await serviceClient().from('piece_versions').select('*').eq('piece_id', f.pieceId).order('number')
  if (error) throw new Error(error.message)
  return data
}

async function pieceStatus(f: PieceFixture): Promise<string> {
  const { data, error } = await serviceClient().from('pieces').select('status').eq('id', f.pieceId).single()
  if (error) throw new Error(error.message)
  return data.status
}

async function folderFiles(f: PieceFixture): Promise<string[]> {
  const { data, error } = await serviceClient().storage.from('team-files').list(`${f.t.teamId}/${f.pieceId}`)
  if (error) throw new Error(error.message)
  return data.map((o) => o.name).sort()
}

/** A campaign reference whose file holds `content`, so tests can tell the images apart. */
async function insertReference(f: PieceFixture, content: string): Promise<string> {
  const storage_path = `${f.t.teamId}/${f.campaignId}/${randomUUID()}.png`
  const up = await serviceClient().storage.from('team-files').upload(storage_path, new Blob([content], { type: 'image/png' }))
  expect(up.error).toBeNull()
  const { data, error } = await serviceClient().from('reference_assets')
    .insert({ campaign_id: f.campaignId, team_id: f.t.teamId, original_name: `${content}.png`, storage_path })
    .select('id').single()
  if (error || !data) throw new Error(`insert reference failed: ${error?.message}`)
  return data.id
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

it('imagem_texto: one version with image and caption, events started/result, message done', async () => {
  const s = await setup()
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { text: 'Banner azul' })

  await processClaim(s.deps(p), await loadEvent(id))

  const [v, ...rest] = await versions(s.f)
  expect(rest).toHaveLength(0)
  expect(v).toMatchObject({ origin: 'agente', phase: 'base', caption: 'Legenda do agente', source_event_id: id })
  expect(v!.image_path).toMatch(new RegExp(`^${s.f.t.teamId}/${s.f.pieceId}/[0-9a-f-]{36}\\.png$`))
  const events = await eventsAfter(s.f, id)
  expect(events.map((e) => e.kind)).toEqual(['agent_started', 'version_added', 'status_changed', 'agent_result'])
  expect(events[0]!.body).toEqual({
    message_ids: [id], round: 1,
    models: { text: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, image: { provider: 'gemini', model: 'gemini-nano-banana-2.1' } },
    reference_count: 0, dropped_reference_ids: [],
  })
  expect(events[3]!.body).toEqual({
    message_ids: [id], round: 1, version_id: v!.id, version_number: 1, image_prompt: 'A blue banner with the product',
  })
  expect(p.calls.image[0]!.prompt).toBe('A blue banner with the product')
  expect(await delivery(id)).toBe('done')
  expect(await pieceStatus(s.f)).toBe('base_em_revisao')
  expect(s.lines.join('\n')).not.toContain(KEYS.anthropic)
})

it('texto piece calls only the text provider', async () => {
  const s = await setup('texto', ['anthropic'])
  const p = fakeProviders({ plan: JSON.stringify({ caption: 'Só texto' }) })
  const id = await createClaimedMessage(s.f)

  await processClaim(s.deps(p), await loadEvent(id))

  expect(p.calls.text).toHaveLength(1)
  expect(p.calls.image).toHaveLength(0)
  expect(await versions(s.f)).toEqual([expect.objectContaining({ image_path: null, caption: 'Só texto' })])
  const result = (await eventsAfter(s.f, id)).find((e) => e.kind === 'agent_result')
  expect(result!.body.image_prompt).toBeNull()
  expect(await delivery(id)).toBe('done')
})

it('uses the model chosen in the message', async () => {
  const s = await setup('imagem_texto', ['anthropic', 'openai', 'gemini', 'fal'])
  const p = fakeProviders()
  const model = { text: { provider: 'openai', model: 'gpt-6-astra' }, image: { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max/multi' } }
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { model })

  await processClaim(s.deps(p), await loadEvent(id))

  expect(p.calls.text.map((c) => c.model)).toEqual(['gpt-6-astra'])
  expect(p.calls.image.map((c) => c.model)).toEqual(['fal-ai/flux-pro/kontext/max/multi'])
  expect((await eventsAfter(s.f, id))[0]!.body.models).toEqual(model)
})

it('defaults to the first catalog model with a key', async () => {
  const s = await setup('imagem_texto', ['openai', 'gemini'])
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f)

  await processClaim(s.deps(p), await loadEvent(id))

  expect(p.calls.text.map((c) => c.model)).toEqual(['gpt-6-astra'])
  expect(p.calls.image.map((c) => c.model)).toEqual(['gemini-nano-banana-2.1'])
})

it('sends current version image first, then references, capped at maxReferenceImages', async () => {
  const s = await setup()
  const current = await createAgentVersion(s.f, { caption: 'Atual' })
  // The default image model; the current image takes one of its slots, so two references are dropped.
  const cap = findModel({ provider: 'gemini', model: 'gemini-nano-banana-2.1' }, 'image')!.maxReferenceImages
  const names = Array.from({ length: cap + 1 }, (_, i) => `ref${i + 1}`)
  const refs = []
  for (const name of names) refs.push(await insertReference(s.f, name))
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { referenceAssetIds: refs })

  await processClaim(s.deps(p), await loadEvent(id))

  const images = p.calls.image[0]!.images
  const currentBytes = await s.db.downloadFile(current.image_path!)
  expect(images.map((i) => text(i.bytes))).toEqual([text(currentBytes.bytes), ...names.slice(0, cap - 1)])
  const started = (await eventsAfter(s.f, id))[0]!
  expect(started.body).toMatchObject({ reference_count: cap - 1, dropped_reference_ids: refs.slice(cap - 1) })
  expect(p.calls.text[0]!.prompt).toContain(`Imagens anexadas: ${cap}; a primeira é a versão atual da peça`)
})

it('reuses the references of the latest message when the batch has none', async () => {
  const s = await setup()
  const ref = await insertReference(s.f, 'antiga')
  const first = await createClaimedMessage(s.f, TEST_EXECUTOR, { referenceAssetIds: [ref] })
  await s.db.complete(first, 'done')
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { text: 'Fundo mais claro' })

  await processClaim(s.deps(p), await loadEvent(id))

  expect(p.calls.image[0]!.images.map((i) => text(i.bytes))).toEqual(['antiga'])
})

it('folds messages queued during generation into the next round', async () => {
  const s = await setup()
  let second = 0
  const p = fakeProviders({
    plan: async () => {
      if (!second) {
        const { data, error } = await s.f.t.members.designer.client.rpc('post_message', { p_piece: s.f.pieceId, p_text: 'Fundo mais claro' })
        expect(error).toBeNull()
        second = data.id
      }
      return JSON.stringify({ image_prompt: 'prompt', caption: 'legenda' })
    },
  })
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { text: 'Banner azul' })

  await processClaim(s.deps(p), await loadEvent(id))

  expect(await versions(s.f)).toHaveLength(2)
  const results = (await eventsAfter(s.f, id)).filter((e) => e.kind === 'agent_result')
  expect(results.map((r) => [r.body.round, r.body.message_ids])).toEqual([[1, [id]], [2, [second]]])
  expect(await delivery(id)).toBe('done')
  expect(await delivery(second)).toBe('done')
  expect(p.calls.text).toHaveLength(2)
  expect(p.calls.text[1]!.prompt).toContain('Fundo mais claro')
})

it('does not call providers outside gerando/base_em_revisao', async () => {
  const s = await setup()
  const id = await createClaimedMessage(s.f)
  expect((await serviceClient().from('pieces').update({ status: 'acabamento' }).eq('id', s.f.pieceId)).error).toBeNull()
  const p = fakeProviders()
  const getKey = vi.spyOn(s.db, 'getProviderKey')

  await processClaim(s.deps(p), await loadEvent(id))

  const [error, ...rest] = await eventsAfter(s.f, id)
  expect(rest).toHaveLength(0)
  expect(error).toMatchObject({ kind: 'agent_error', body: { code: 'wrong_status', message_ids: [id], round: 1, image_prompt: null } })
  expect(error!.body.message).toBe('A peça está em acabamento. Volte uma etapa para gerar novas versões base.')
  expect(p.calls).toEqual({ text: [], image: [] })
  expect(getKey).not.toHaveBeenCalled()
  expect(await delivery(id)).toBe('failed')
})

it('missing key fails the message with missing_key', async () => {
  const s = await setup('imagem_texto', ['anthropic'])
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f)

  await processClaim(s.deps(p), await loadEvent(id))

  const [error] = await eventsAfter(s.f, id)
  expect(error).toMatchObject({ kind: 'agent_error', body: { code: 'missing_key' } })
  expect(error!.body.message).toBe('Nenhuma chave cadastrada para um provedor de imagem. Peça ao admin do time para cadastrar.')
  expect(p.calls).toEqual({ text: [], image: [] })
  expect(await delivery(id)).toBe('failed')
})

it('key removed after the message was queued fails with missing_key for that provider', async () => {
  const s = await setup('texto', ['anthropic'])
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f)
  vi.spyOn(s.db, 'getProviderKey').mockResolvedValue(null)

  await processClaim(s.deps(p), await loadEvent(id))

  const [error] = await eventsAfter(s.f, id)
  expect(error!.body.message).toBe('Nenhuma chave cadastrada para anthropic. Peça ao admin do time para cadastrar.')
  expect(p.calls.text).toHaveLength(0)
  expect(await delivery(id)).toBe('failed')
})

it('invalid model choice fails with invalid_model', async () => {
  const s = await setup()
  const p = fakeProviders()
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { model: { image: { provider: 'gemini', model: 'nope' } } })

  await processClaim(s.deps(p), await loadEvent(id))

  const [error] = await eventsAfter(s.f, id)
  expect(error).toMatchObject({ kind: 'agent_error', body: { code: 'invalid_model', message: 'O modelo nope não está disponível para imagem.' } })
  expect(p.calls).toEqual({ text: [], image: [] })
  expect(await delivery(id)).toBe('failed')
})

it('agent_error never contains the key', async () => {
  const s = await setup()
  // An adapter that forgot to redact: the job must redact again with the round's keys.
  const p = fakeProviders({ textError: new ProviderError('provider_error', 'anthropic', `invalid api key ${KEYS.anthropic}`) })
  const id = await createClaimedMessage(s.f)

  await processClaim(s.deps(p), await loadEvent(id))

  const events = await eventsAfter(s.f, id)
  const error = events.find((e) => e.kind === 'agent_error')!
  expect(error.body).toMatchObject({ code: 'provider_error', message: 'anthropic recusou o pedido: invalid api key [chave]' })
  expect(JSON.stringify(events)).not.toContain(KEYS.anthropic)
  expect(s.lines.join('\n')).not.toContain(KEYS.anthropic)
  expect(await delivery(id)).toBe('failed')
})

it('image provider error keeps the image prompt in agent_error', async () => {
  const s = await setup()
  const p = fakeProviders({ image: async () => { throw new ProviderError('timeout', 'gemini', 'aborted') } })
  const id = await createClaimedMessage(s.f)

  await processClaim(s.deps(p), await loadEvent(id))

  const error = (await eventsAfter(s.f, id)).find((e) => e.kind === 'agent_error')!
  expect(error.body).toMatchObject({
    code: 'timeout', message: 'gemini não respondeu a tempo. Tente de novo.', image_prompt: 'A blue banner with the product',
  })
  expect(await versions(s.f)).toHaveLength(0)
})

it('unexpected error becomes internal and is logged without failing the call', async () => {
  const s = await setup()
  const ref = await insertReference(s.f, 'ref')
  vi.spyOn(s.db, 'downloadFile').mockRejectedValue(new Error(`storage down ${KEYS.gemini}`))
  const id = await createClaimedMessage(s.f, TEST_EXECUTOR, { referenceAssetIds: [ref] })

  await expect(processClaim(s.deps(fakeProviders()), await loadEvent(id))).resolves.toBeUndefined()

  const [error] = await eventsAfter(s.f, id)
  expect(error).toMatchObject({ kind: 'agent_error', body: { code: 'internal', message: 'Erro interno do agente. Tente de novo.' } })
  const logged = s.lines.map((l) => JSON.parse(l)).find((l) => l.level === 'error')
  expect(logged.error).toBe('storage down [chave]')
  expect(await delivery(id)).toBe('failed')
})

it('complete failing after the version: no agent_error, and the requeued message is not generated again', async () => {
  const s = await setup()
  const id = await createClaimedMessage(s.f)
  vi.spyOn(s.db, 'complete').mockRejectedValueOnce(new Error('complete failed: db down'))

  await expect(processClaim(s.deps(fakeProviders()), await loadEvent(id))).resolves.toBeUndefined()

  expect((await eventsAfter(s.f, id)).map((e) => e.kind)).not.toContain('agent_error')
  expect(await versions(s.f)).toHaveLength(1)
  expect(await delivery(id)).toBe('claimed')
  expect(s.lines.map((l) => JSON.parse(l).level)).toContain('error')

  // release_stale_claims requeued the message and an executor claimed it again.
  const { error } = await serviceClient().from('session_events')
    .update({ delivery: 'claimed', claimed_by: TEST_EXECUTOR, claimed_at: new Date().toISOString() }).eq('id', id)
  expect(error).toBeNull()
  const again = fakeProviders()
  await processClaim(s.deps(again), await loadEvent(id))

  expect(again.calls.text).toEqual([])
  expect(again.calls.image).toEqual([])
  expect(await versions(s.f)).toHaveLength(1)
  expect(await delivery(id)).toBe('done')
})

it('claim lost after the version: the requeued message is completed without a second version', async () => {
  const s = await setup()
  const id = await createClaimedMessage(s.f)
  const requeue = { delivery: 'queued', claimed_by: null, claimed_at: null }
  const addAgentEvent = s.db.addAgentEvent.bind(s.db)
  vi.spyOn(s.db, 'addAgentEvent').mockImplementation(async (source, kind, body) => {
    // release_stale_claims requeued the message between add_agent_version and agent_result.
    if (kind === 'agent_result') expect((await serviceClient().from('session_events').update(requeue).eq('id', id)).error).toBeNull()
    return addAgentEvent(source, kind, body)
  })

  await processClaim(s.deps(fakeProviders()), await loadEvent(id))

  expect(await versions(s.f)).toHaveLength(1)
  expect(await delivery(id)).toBe('queued')
  vi.mocked(s.db.addAgentEvent).mockRestore()

  // Another executor claims the requeued message.
  const other = createExecutorDb(serviceClient(), 'other-executor')
  const { error } = await serviceClient().from('session_events')
    .update({ delivery: 'claimed', claimed_by: 'other-executor', claimed_at: new Date().toISOString() }).eq('id', id)
  expect(error).toBeNull()
  const again = fakeProviders()
  await processClaim({ ...s.deps(again), db: other }, await loadEvent(id))

  expect(again.calls.text).toEqual([])
  expect(again.calls.image).toEqual([])
  expect(await versions(s.f)).toHaveLength(1)
  expect(await delivery(id)).toBe('done')
  expect((await eventsAfter(s.f, id)).map((e) => e.kind)).not.toContain('agent_error')
})

it('addAgentVersion error after the commit keeps the file of the stored version', async () => {
  const s = await setup()
  const id = await createClaimedMessage(s.f)
  const addAgentVersion = s.db.addAgentVersion.bind(s.db)
  vi.spyOn(s.db, 'addAgentVersion').mockImplementation(async (...args) => {
    await addAgentVersion(...args)
    throw new Error('addAgentVersion failed: fetch failed')
  })

  await processClaim(s.deps(fakeProviders()), await loadEvent(id))

  const [version] = await versions(s.f)
  expect(version.image_path).toBeTruthy()
  expect(await folderFiles(s.f)).toContain(version.image_path.split('/').at(-1))
  expect((await eventsAfter(s.f, id)).map((e) => e.kind)).not.toContain('agent_error')
  expect(await delivery(id)).toBe('done')
})

it('claim lost: no version, uploaded file removed', async () => {
  const s = await setup()
  const id = await createClaimedMessage(s.f)
  const p = fakeProviders({
    image: async () => {
      // release_stale_claims requeued the message while the image was generating.
      expect((await serviceClient().from('session_events').update({ delivery: 'queued', claimed_by: null, claimed_at: null }).eq('id', id)).error).toBeNull()
      return FAKE_IMAGE
    },
  })

  await processClaim(s.deps(p), await loadEvent(id))

  expect(await versions(s.f)).toHaveLength(0)
  expect(await folderFiles(s.f)).toEqual([])
  expect((await eventsAfter(s.f, id)).map((e) => e.kind)).toEqual(['agent_started'])
  expect(await delivery(id)).toBe('queued')
  expect(s.lines.map((l) => JSON.parse(l).level)).toContain('warn')
  // Leave nothing in the queue for other test files that claim the oldest message.
  await serviceClient().from('session_events').update({ delivery: 'failed' }).eq('id', id)
})

it('approval during generation: wrong_status, file removed', async () => {
  const s = await setup()
  const base = await createAgentVersion(s.f)
  const before = await folderFiles(s.f)
  const id = await createClaimedMessage(s.f)
  const p = fakeProviders({
    image: async (): Promise<GeneratedImage> => {
      const { error } = await s.f.t.members.gestor.client.rpc('approve_version', { p_piece: s.f.pieceId, p_version: base.id })
      expect(error).toBeNull()
      return FAKE_IMAGE
    },
  })

  await processClaim(s.deps(p), await loadEvent(id))

  expect(await versions(s.f)).toHaveLength(1)
  expect(await folderFiles(s.f)).toEqual(before)
  const error = (await eventsAfter(s.f, id)).find((e) => e.kind === 'agent_error')!
  expect(error.body).toMatchObject({ code: 'wrong_status', message: 'A peça está em acabamento. Volte uma etapa para gerar novas versões base.' })
  expect(await delivery(id)).toBe('failed')
})

it('touches the claim while generating', async () => {
  const s = await setup()
  const id = await createClaimedMessage(s.f)
  const claimedAt = async () =>
    (await serviceClient().from('session_events').select('claimed_at').eq('id', id).single()).data!.claimed_at as string
  // Measured inside the generation: absorbPending at the start also renews claimed_at.
  let initial = ''
  let during = ''
  const p = fakeProviders({
    image: async () => {
      initial = await claimedAt()
      await new Promise((r) => setTimeout(r, 200))
      during = await claimedAt()
      return FAKE_IMAGE
    },
  })

  await processClaim(s.deps(p, { touchIntervalMs: 50 }), await loadEvent(id))

  expect(new Date(during).getTime()).toBeGreaterThan(new Date(initial).getTime())
  expect(await delivery(id)).toBe('done')
})

describe('resolveModels', () => {
  const msg = (model: unknown) => ({ id: 1, piece_id: 'p', team_id: 't', author_id: null, body: { text: 'x', model, reference_asset_ids: [] } })
  const hist = (model: unknown) => ({ id: 0, author: 'a', text: 'x', model, reference_asset_ids: [] })

  it('prefers the latest non-null choice in the batch, then the history', () => {
    const fromBatch = resolveModels('texto', [msg({ text: { provider: 'openai', model: 'gpt-6-astra' } }), msg(null)], [hist(null)], ['anthropic', 'openai'])
    expect(fromBatch).toMatchObject({ text: { model: 'gpt-6-astra' }, image: null })
    const fromHistory = resolveModels('texto', [msg(null)], [hist({ text: { provider: 'anthropic', model: 'claude-opus-5-5' } })], ['anthropic'])
    expect(fromHistory).toMatchObject({ text: { model: 'claude-opus-5-5' } })
  })

  it('a chosen model whose provider has no key is missing_key for that provider', () => {
    expect(resolveModels('imagem', [msg({ image: { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max/multi' } })], [], ['anthropic', 'gemini']))
      .toEqual({ code: 'missing_key', provider: 'fal' })
  })

  it('a choice outside ModelChoiceSchema is invalid_model', () => {
    expect(resolveModels('texto', [msg({ text: 'claude' })], [], ['anthropic'])).toMatchObject({ code: 'invalid_model' })
  })

  it('a text model chosen for the image capability is invalid_model', () => {
    expect(resolveModels('imagem', [msg({ image: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })], [], ['anthropic']))
      .toEqual({ code: 'invalid_model', model: 'claude-sonnet-5-5', capability: 'image' })
  })
})
