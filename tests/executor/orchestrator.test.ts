import type { InboxMessage, PieceContext } from '../../packages/executor/src/db.ts'
import { buildOrchestratorPrompt, ORCHESTRATOR_SYSTEM, parsePlan, planRound } from '../../packages/executor/src/orchestrator.ts'
import { ProviderError, type TextRequest } from '../../packages/executor/src/providers/types.ts'

const AUTHOR = '11111111-1111-1111-1111-111111111111'

function makeCtx(over: Partial<PieceContext> = {}): PieceContext {
  return {
    piece: { id: 'p1', team_id: 't1', campaign_id: 'c1', title: 'Post de lançamento', kind: 'imagem', status: 'gerando' },
    campaignName: 'Verão 2027',
    history: [
      { id: 1, author: 'Ana', text: 'Garrafa na praia', model: null, reference_asset_ids: [] },
      { id: 5, author: 'Bia', text: 'Mais luz', model: null, reference_asset_ids: [] },
    ],
    latestVersion: { id: 'v1', number: 1, image_path: 'x.png', caption: 'Refresque seu verão' },
    lastImagePrompt: 'a bottle on the beach',
    keyedProviders: ['anthropic'],
    memberNames: { [AUTHOR]: 'Bia' },
    ...over,
  }
}

const msg = (id: number, text: string, author_id: string | null = AUTHOR): InboxMessage =>
  ({ id, piece_id: 'p1', team_id: 't1', author_id, body: { text, model: null, reference_asset_ids: [] } })

const ctx = makeCtx()
const batch = [msg(5, 'Mais luz'), msg(6, 'E fundo azul', null)]

it('lists history before the current request and excludes batch ids from history', () => {
  const p = buildOrchestratorPrompt(ctx, batch, 2, true)
  expect(p.indexOf('Histórico:')).toBeLessThan(p.indexOf('Pedido atual:'))
  expect(p).toContain('Imagens anexadas: 2; a primeira é a versão atual da peça')
  expect(p.split('Pedido atual:')[0]).not.toContain(`[#${batch[0]!.id}]`)
})

it('renders every line in order, with member names and the Alguém fallback', () => {
  expect(buildOrchestratorPrompt(ctx, batch, 2, true)).toBe([
    'Campanha: Verão 2027',
    'Peça: Post de lançamento (tipo: imagem; chaves pedidas: image_prompt)',
    'Imagens anexadas: 2; a primeira é a versão atual da peça',
    'Prompt de imagem anterior: a bottle on the beach',
    'Legenda atual: Refresque seu verão',
    'Histórico:',
    '[#1] Ana: Garrafa na praia',
    'Pedido atual:',
    '[#5] Bia: Mais luz',
    '[#6] Alguém: E fundo azul',
  ].join('\n'))
})

it('uses placeholders for empty context', () => {
  const p = buildOrchestratorPrompt(makeCtx({ history: [], latestVersion: null, lastImagePrompt: null }), [msg(9, 'Oi')], 0, false)
  expect(p).toContain('Imagens anexadas: 0\n')
  expect(p).toContain('Prompt de imagem anterior: (nenhum)')
  expect(p).toContain('Legenda atual: (nenhuma)')
  expect(p).toContain('Histórico:\n(vazio)\nPedido atual:')
})

it('asks for both keys on imagem_texto', () => {
  const p = buildOrchestratorPrompt(makeCtx({ piece: { ...ctx.piece, kind: 'imagem_texto' } }), batch, 0, false)
  expect(p).toContain('chaves pedidas: image_prompt e caption')
})

it('asks only for caption on texto', () => {
  const p = buildOrchestratorPrompt(makeCtx({ piece: { ...ctx.piece, kind: 'texto' } }), batch, 0, false)
  expect(p).toContain('(tipo: texto; chaves pedidas: caption)')
})

it('parses JSON wrapped in prose or code fences', () => {
  expect(parsePlan('Claro!\n```json\n{"image_prompt":" a bottle "}\n```', 'imagem', 'anthropic')).toEqual({ imagePrompt: 'a bottle', caption: null })
})

it('imagem piece drops caption', () => {
  expect(parsePlan('{"image_prompt":"y","caption":"x"}', 'imagem', 'openai')).toEqual({ imagePrompt: 'y', caption: null })
})

it('texto piece drops image_prompt', () => {
  expect(parsePlan('{"caption":"x","image_prompt":"y"}', 'texto', 'openai')).toEqual({ imagePrompt: null, caption: 'x' })
})

it('null in a key the piece kind drops is not an error', () => {
  expect(parsePlan('{"image_prompt":"x","caption":null}', 'imagem', 'openai')).toEqual({ imagePrompt: 'x', caption: null })
  expect(parsePlan('{"image_prompt":null,"caption":"x"}', 'texto', 'openai')).toEqual({ imagePrompt: null, caption: 'x' })
})

it('imagem_texto keeps both keys', () => {
  expect(parsePlan('{"caption":" x ","image_prompt":"y"}', 'imagem_texto', 'openai')).toEqual({ imagePrompt: 'y', caption: 'x' })
})

/** Runs parsePlan and returns the thrown error. */
function planError(raw: string, kind: 'imagem' | 'texto' | 'imagem_texto'): ProviderError {
  let err: unknown
  try { parsePlan(raw, kind, 'anthropic') } catch (e) { err = e }
  expect(err).toBeInstanceOf(ProviderError)
  expect(err).toMatchObject({ code: 'invalid_output', provider: 'anthropic' })
  return err as ProviderError
}

it('missing required key is invalid_output', () => {
  planError('{"image_prompt":"y"}', 'imagem_texto')
  planError('{"caption":"x"}', 'imagem')
})

it('null in a required key is invalid_output', () => {
  planError('{"image_prompt":null}', 'imagem')
  planError('{"image_prompt":"y","caption":null}', 'imagem_texto')
})

it('blank required value is invalid_output', () => {
  planError('{"caption":"   "}', 'texto')
})

it('non-string value is invalid_output', () => {
  planError('{"caption":42}', 'texto')
})

it('non-JSON output is invalid_output', () => {
  planError('Desculpe, não consigo ajudar.', 'texto')
  planError('{caption: x}', 'texto')
  planError('[]', 'texto')
})

it('planRound sends the system prompt, the built prompt and the output cap', async () => {
  const calls: { key: string; req: TextRequest; signal: AbortSignal }[] = []
  const text = { async generateText(key: string, req: TextRequest, signal: AbortSignal) { calls.push({ key, req, signal }); return '{"image_prompt":"z"}' } }
  const signal = AbortSignal.timeout(5000)
  const plan = await planRound({
    text, provider: 'anthropic', key: 'sk-x', model: 'claude-sonnet-5-5', effort: null, ctx, batch, referenceCount: 2, hasCurrentImage: true, signal,
  })
  expect(plan).toEqual({ imagePrompt: 'z', caption: null })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.key).toBe('sk-x')
  expect(calls[0]!.signal).toBe(signal)
  // Without a chosen effort the request has no effort key, so the adapter sends the provider default.
  expect(calls[0]!.req).toStrictEqual({
    model: 'claude-sonnet-5-5', system: ORCHESTRATOR_SYSTEM, prompt: buildOrchestratorPrompt(ctx, batch, 2, true), maxOutputTokens: 32000,
  })
})

it('planRound passes the chosen effort to the text provider', async () => {
  const reqs: TextRequest[] = []
  const text = { async generateText(_key: string, req: TextRequest) { reqs.push(req); return '{"image_prompt":"z"}' } }
  await planRound({
    text, provider: 'openai', key: 'sk-x', model: 'gpt-6-astra', effort: 'xhigh', ctx, batch, referenceCount: 0, hasCurrentImage: false,
    signal: AbortSignal.timeout(5000),
  })
  expect(reqs.map((r) => r.effort)).toEqual(['xhigh'])
})

it('ORCHESTRATOR_SYSTEM asks for JSON only and keeps the product faithful', () => {
  expect(ORCHESTRATOR_SYSTEM).toContain('Responda SOMENTE com um objeto JSON')
  expect(ORCHESTRATOR_SYSTEM).toContain('Peça sempre para manter o produto fiel às referências.')
})
