import { z } from 'zod'
import { ProviderSchema, type PieceStatus, type Provider } from './domain.ts'

// Contract shared by the agent executor and the desktop app: model catalog,
// the model choice sent with post_message, agent event bodies and error copy.

export type ModelCapability = 'text' | 'image'

export type CatalogModel = {
  provider: Provider
  model: string
  label: string
  capability: ModelCapability
  // Reasoning efforts the model accepts; empty when it has no effort control.
  efforts: readonly string[]
  maxReferenceImages: number
}

// Effort values of OpenAI reasoning.effort and Anthropic output_config.effort.
const TEXT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// The only place with model IDs. Order is the default-model preference: the
// executor picks the first model of each capability whose provider has a key.
export const MODEL_CATALOG: readonly CatalogModel[] = [
  { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', capability: 'text', efforts: TEXT_EFFORTS, maxReferenceImages: 0 },
  { provider: 'openai', model: 'gpt-6-astra', label: 'GPT-6 Astra', capability: 'text', efforts: TEXT_EFFORTS, maxReferenceImages: 0 },
  { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', capability: 'text', efforts: TEXT_EFFORTS, maxReferenceImages: 0 },
  { provider: 'gemini', model: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1', capability: 'image', efforts: ['minimal', 'medium', 'high'], maxReferenceImages: 10 },
  { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max/multi', label: 'Flux Kontext Max', capability: 'image', efforts: [], maxReferenceImages: 4 },
  { provider: 'gemini', model: 'gemini-3-pro-image', label: 'Nano Banana Pro', capability: 'image', efforts: [], maxReferenceImages: 6 },
]

// The schema only checks the shape; the executor checks that the model accepts the effort.
export const ModelRefSchema = z.object({ provider: ProviderSchema, model: z.string().min(1), effort: z.string().min(1).optional() }).strict()
export type ModelRef = z.infer<typeof ModelRefSchema>

// Shape of p_model in post_message.
export const ModelChoiceSchema = z.object({ text: ModelRefSchema.optional(), image: ModelRefSchema.optional() }).strict()
export type ModelChoice = z.infer<typeof ModelChoiceSchema>

export function findModel(ref: ModelRef, capability: ModelCapability): CatalogModel | undefined {
  return MODEL_CATALOG.find(m => m.provider === ref.provider && m.model === ref.model && m.capability === capability)
}

/** A catalog model with the effort chosen for it; null means the provider default. */
export type ChosenModel = CatalogModel & { effort: string | null }
export type CheckedChoice = Partial<Record<ModelCapability, ChosenModel>>

/**
 * Checks a stored model choice: it passes ModelChoiceSchema, every model it names is in the
 * catalog for its capability, and every effort is one the model accepts.
 */
export function checkModelChoice(choice: unknown): CheckedChoice | AgentErrorInput {
  const parsed = ModelChoiceSchema.safeParse(choice)
  if (!parsed.success) {
    // shortcut: the malformed choice has no readable model name, so the copy names none.
    return { code: 'invalid_model', model: '(inválido)', capability: 'text' }
  }
  const chosen: CheckedChoice = {}
  for (const capability of ['text', 'image'] as const) {
    const ref = parsed.data[capability]
    if (!ref) continue
    const model = findModel(ref, capability)
    if (!model) return { code: 'invalid_model', model: ref.model, capability }
    if (ref.effort !== undefined && !model.efforts.includes(ref.effort)) {
      return { code: 'invalid_model', model: `${ref.model} com esforço ${ref.effort}`, capability }
    }
    chosen[capability] = { ...model, effort: ref.effort ?? null }
  }
  return chosen
}

/**
 * The model of `capability` in the latest valid choice that names it (`choices` oldest first).
 * Invalid choices are skipped whole, so an old mistake or a model since removed from the catalog never locks the piece.
 */
export function inheritedModel(choices: unknown[], capability: ModelCapability): ChosenModel | undefined {
  return choices.map((c) => checkModelChoice(c)).map((c) => ('code' in c ? undefined : c[capability])).findLast((m) => m !== undefined)
}

export const AGENT_ERROR_CODES = [
  'missing_key',
  'invalid_model',
  'wrong_status',
  'provider_error',
  'timeout',
  'invalid_output',
  'internal',
] as const
export const AgentErrorCodeSchema = z.enum(AGENT_ERROR_CODES)
export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>

const MessageIdsSchema = z.array(z.number().int())
const RoundSchema = z.number().int().positive()

export const AgentStartedBodySchema = z.object({
  message_ids: MessageIdsSchema,
  round: RoundSchema,
  models: z.object({ text: ModelRefSchema.nullable(), image: ModelRefSchema.nullable() }),
  reference_count: z.number().int().nonnegative(),
  dropped_reference_ids: z.array(z.string()),
})
export type AgentStartedBody = z.infer<typeof AgentStartedBodySchema>

// image_prompt is the prompt shown (collapsed) in the chat.
export const AgentResultBodySchema = z.object({
  message_ids: MessageIdsSchema,
  round: RoundSchema,
  version_id: z.string(),
  version_number: z.number().int(),
  image_prompt: z.string().nullable(),
})
export type AgentResultBody = z.infer<typeof AgentResultBodySchema>

export const AgentErrorBodySchema = z.object({
  message_ids: MessageIdsSchema,
  round: RoundSchema,
  code: AgentErrorCodeSchema,
  message: z.string(),
  image_prompt: z.string().nullable(),
})
export type AgentErrorBody = z.infer<typeof AgentErrorBodySchema>

export type AgentErrorInput =
  | { code: 'missing_key'; provider: Provider }
  | { code: 'missing_key'; capability: ModelCapability }
  | { code: 'invalid_model'; model: string; capability: ModelCapability }
  | { code: 'wrong_status'; status: PieceStatus }
  | { code: 'provider_error'; provider: Provider; detail: string }
  | { code: 'timeout'; provider: Provider }
  | { code: 'invalid_output'; provider: Provider }
  | { code: 'internal' }

const capabilityName = (c: ModelCapability) => (c === 'text' ? 'texto' : 'imagem')

// Chat copy in pt-BR; texts are fixed by the plan (Task 2 table).
export function agentErrorMessage(e: AgentErrorInput): string {
  switch (e.code) {
    case 'missing_key':
      return 'provider' in e
        ? `Nenhuma chave cadastrada para ${e.provider}. Peça ao admin do time para cadastrar.`
        : `Nenhuma chave cadastrada para um provedor de ${capabilityName(e.capability)}. Peça ao admin do time para cadastrar.`
    case 'invalid_model':
      return `O modelo ${e.model} não está disponível para ${capabilityName(e.capability)}.`
    case 'wrong_status':
      return `A peça está em ${e.status}. Volte uma etapa para gerar novas versões base.`
    case 'provider_error':
      return `${e.provider} recusou o pedido: ${e.detail}`
    case 'timeout':
      return `${e.provider} não respondeu a tempo. Tente de novo.`
    case 'invalid_output':
      return `${e.provider} devolveu uma resposta que o agente não entendeu. Tente de novo.`
    case 'internal':
      return 'Erro interno do agente. Tente de novo.'
  }
}
