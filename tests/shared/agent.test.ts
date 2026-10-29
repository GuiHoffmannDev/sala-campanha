import {
  AGENT_ERROR_CODES,
  AgentErrorBodySchema,
  AgentResultBodySchema,
  AgentStartedBodySchema,
  agentErrorMessage,
  findModel,
  inheritedModel,
  MODEL_CATALOG,
  ModelChoiceSchema,
} from '../../packages/shared/src/agent.ts'
import { PROVIDERS } from '../../packages/shared/src/domain.ts'

it('catalog only uses known providers and has a text and an image model', () => {
  for (const m of MODEL_CATALOG) expect(PROVIDERS).toContain(m.provider)
  expect(MODEL_CATALOG.some(m => m.capability === 'text')).toBe(true)
  expect(MODEL_CATALOG.some(m => m.capability === 'image')).toBe(true)
})

it('catalog keeps krea out and text models take no reference images', () => {
  expect(MODEL_CATALOG.some(m => m.provider === 'krea')).toBe(false)
  for (const m of MODEL_CATALOG.filter(m => m.capability === 'text')) expect(m.maxReferenceImages).toBe(0)
  // Order is the default-model preference: the first text model is Claude Sonnet.
  expect(MODEL_CATALOG[0]).toMatchObject({ provider: 'anthropic', capability: 'text' })
})

it('findModel requires the capability', () => {
  expect(findModel({ provider: 'gemini', model: 'gemini-nano-banana-2.1' }, 'image')?.label).toBe('Nano Banana 2.1')
  expect(findModel({ provider: 'gemini', model: 'gemini-nano-banana-2.1' }, 'text')).toBeUndefined()
})

it('findModel requires the provider to match the model', () => {
  expect(findModel({ provider: 'openai', model: 'claude-sonnet-5-5' }, 'text')).toBeUndefined()
})

it('ModelChoiceSchema rejects unknown keys and providers', () => {
  expect(ModelChoiceSchema.safeParse({ text: { provider: 'openai', model: 'gpt-6-astra' } }).success).toBe(true)
  expect(ModelChoiceSchema.safeParse({ video: {} }).success).toBe(false)
  expect(ModelChoiceSchema.safeParse({ image: { provider: 'midjourney', model: 'x' } }).success).toBe(false)
  expect(ModelChoiceSchema.safeParse({ text: { provider: 'openai', model: '' } }).success).toBe(false)
})

it('ModelChoiceSchema rejects unknown keys inside a model ref', () => {
  expect(ModelChoiceSchema.safeParse({ text: { provider: 'openai', model: 'gpt-6-astra', foo: 1 } }).success).toBe(false)
})

it('ModelChoiceSchema accepts an optional non-empty effort', () => {
  expect(ModelChoiceSchema.safeParse({ text: { provider: 'openai', model: 'gpt-6-astra', effort: 'low' } }).success).toBe(true)
  expect(ModelChoiceSchema.safeParse({ text: { provider: 'openai', model: 'gpt-6-astra', effort: '' } }).success).toBe(false)
})

it('catalog efforts and reference limits match the Task A table', () => {
  const reasoning = ['low', 'medium', 'high', 'xhigh', 'max']
  expect(MODEL_CATALOG.map(({ model, efforts, maxReferenceImages }) => ({ model, efforts, maxReferenceImages }))).toEqual([
    { model: 'claude-sonnet-5-5', efforts: reasoning, maxReferenceImages: 0 },
    { model: 'gpt-6-astra', efforts: reasoning, maxReferenceImages: 0 },
    { model: 'claude-opus-5-5', efforts: reasoning, maxReferenceImages: 0 },
    { model: 'gemini-nano-banana-2.1', efforts: ['minimal', 'medium', 'high'], maxReferenceImages: 10 },
    { model: 'fal-ai/flux-pro/kontext/max/multi', efforts: [], maxReferenceImages: 4 },
    { model: 'gemini-3-pro-image', efforts: [], maxReferenceImages: 6 },
  ])
})

it('error messages match the fixed copy', () => {
  expect(agentErrorMessage({ code: 'missing_key', provider: 'gemini' }))
    .toBe('Nenhuma chave cadastrada para gemini. Peça ao admin do time para cadastrar.')
  expect(agentErrorMessage({ code: 'missing_key', capability: 'text' }))
    .toBe('Nenhuma chave cadastrada para um provedor de texto. Peça ao admin do time para cadastrar.')
  expect(agentErrorMessage({ code: 'missing_key', capability: 'image' }))
    .toBe('Nenhuma chave cadastrada para um provedor de imagem. Peça ao admin do time para cadastrar.')
  expect(agentErrorMessage({ code: 'invalid_model', model: 'x', capability: 'image' }))
    .toBe('O modelo x não está disponível para imagem.')
  expect(agentErrorMessage({ code: 'wrong_status', status: 'acabamento' }))
    .toBe('A peça está em acabamento. Volte uma etapa para gerar novas versões base.')
  expect(agentErrorMessage({ code: 'provider_error', provider: 'openai', detail: 'quota' }))
    .toBe('openai recusou o pedido: quota')
  expect(agentErrorMessage({ code: 'timeout', provider: 'fal' }))
    .toBe('fal não respondeu a tempo. Tente de novo.')
  expect(agentErrorMessage({ code: 'invalid_output', provider: 'anthropic' }))
    .toBe('anthropic devolveu uma resposta que o agente não entendeu. Tente de novo.')
  expect(agentErrorMessage({ code: 'internal' })).toBe('Erro interno do agente. Tente de novo.')
})

it('agent event bodies parse the contract shapes', () => {
  expect(AgentStartedBodySchema.safeParse({
    message_ids: [1], round: 1, models: { text: { provider: 'openai', model: 'gpt-6-astra' }, image: null },
    reference_count: 0, dropped_reference_ids: [],
  }).success).toBe(true)
  // The effort must survive the parse, not be stripped as an unknown key.
  expect(AgentStartedBodySchema.parse({
    message_ids: [1], round: 1, models: { text: { provider: 'openai', model: 'gpt-6-astra', effort: 'low' }, image: null },
    reference_count: 0, dropped_reference_ids: [],
  }).models.text).toEqual({ provider: 'openai', model: 'gpt-6-astra', effort: 'low' })
  expect(AgentResultBodySchema.safeParse({
    message_ids: [1, 2], round: 2, version_id: 'v', version_number: 3, image_prompt: null,
  }).success).toBe(true)
  expect(AgentErrorBodySchema.safeParse({
    message_ids: [1], round: 1, code: 'timeout', message: 'm', image_prompt: 'p',
  }).success).toBe(true)
  expect(AgentErrorBodySchema.safeParse({
    message_ids: [1], round: 1, code: 'nope', message: 'm', image_prompt: null,
  }).success).toBe(false)
  expect(AGENT_ERROR_CODES).toEqual(['missing_key', 'invalid_model', 'wrong_status', 'provider_error', 'timeout', 'invalid_output', 'internal'])
})

const opus = { provider: 'anthropic', model: 'claude-opus-5-5' } as const
const astra = { provider: 'openai', model: 'gpt-6-astra' } as const
const fal = { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max/multi' } as const

it('inheritedModel picks the latest valid choice that names the capability', () => {
  const choices = [{ text: { ...opus, effort: 'max' } }, { image: fal }]
  expect(inheritedModel(choices, 'text')).toEqual({ ...findModel(opus, 'text'), effort: 'max' })
  expect(inheritedModel(choices, 'image')).toEqual({ ...findModel(fal, 'image'), effort: null })
  expect(inheritedModel([{ text: astra }, { text: opus }], 'text')?.model).toBe('claude-opus-5-5')
  expect(inheritedModel([], 'text')).toBeUndefined()
})

it('inheritedModel skips an invalid choice whole', () => {
  // The later choice names a valid text model, but its image model is not in the catalog.
  const halfInvalid = { text: opus, image: { provider: 'fal', model: 'nope' } }
  expect(inheritedModel([{ text: astra }, halfInvalid], 'text')?.model).toBe('gpt-6-astra')
  expect(inheritedModel([{ text: astra }, halfInvalid], 'image')).toBeUndefined()
  // An effort the model refuses, a malformed value and null are skipped too.
  expect(inheritedModel([{ text: astra }, { text: { ...opus, effort: 'turbo' } }, 'claude', null], 'text')?.model).toBe('gpt-6-astra')
})
