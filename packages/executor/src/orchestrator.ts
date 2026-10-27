import type { PieceKind, Provider } from '@sala/shared'
import { z } from 'zod'
import type { InboxMessage, PieceContext } from './db.ts'
import { ProviderError, type TextProvider } from './providers/types.ts'

export type Plan = { imagePrompt: string | null; caption: string | null }

export const ORCHESTRATOR_SYSTEM = [
  'Você é o agente de criação da Sala da Campanha e trabalha para um time de marketing.',
  'Leia o pedido atual e o histórico da peça. Responda SOMENTE com um objeto JSON, sem nenhum texto fora dele, com as chaves pedidas:',
  '- "image_prompt": prompt em inglês para o gerador de imagem, com cena, composição, luz e estilo. As imagens anexadas são fotos de referência do produto; quando a primeira for a versão atual da peça, peça ao gerador para editá-la. Peça sempre para manter o produto fiel às referências.',
  '- "caption": o texto da peça em português do Brasil, a menos que o pedido peça outro idioma.',
  'O pedido atual tem prioridade sobre o histórico. Mensagens do pedido atual ajustam o pedido anterior; não começam uma peça nova.',
].join('\n')

const NO_AUTHOR = 'Alguém'
// Reasoning tokens count toward this cap on OpenAI and Anthropic, so it leaves room for a high effort.
export const MAX_OUTPUT_TOKENS = 32000

const REQUESTED_KEYS: Record<PieceKind, string> = {
  imagem: 'image_prompt',
  texto: 'caption',
  imagem_texto: 'image_prompt e caption',
}

export function buildOrchestratorPrompt(ctx: PieceContext, batch: InboxMessage[], referenceCount: number, hasCurrentImage: boolean): string {
  const batchIds = new Set(batch.map((m) => m.id))
  const history = ctx.history.filter((m) => !batchIds.has(m.id)).map((m) => `[#${m.id}] ${m.author}: ${m.text}`)
  const request = batch.map((m) => `[#${m.id}] ${(m.author_id && ctx.memberNames[m.author_id]) || NO_AUTHOR}: ${m.body.text}`)
  return [
    `Campanha: ${ctx.campaignName}`,
    `Peça: ${ctx.piece.title} (tipo: ${ctx.piece.kind}; chaves pedidas: ${REQUESTED_KEYS[ctx.piece.kind]})`,
    `Imagens anexadas: ${referenceCount}${hasCurrentImage ? '; a primeira é a versão atual da peça' : ''}`,
    `Prompt de imagem anterior: ${ctx.lastImagePrompt ?? '(nenhum)'}`,
    `Legenda atual: ${ctx.latestVersion?.caption ?? '(nenhuma)'}`,
    'Histórico:',
    ...(history.length ? history : ['(vazio)']),
    'Pedido atual:',
    ...request,
  ].join('\n')
}

// null is allowed: a model may fill the key the piece kind drops with null.
const PlanSchema = z.object({ image_prompt: z.string().nullish(), caption: z.string().nullish() })

/** Reads the model's JSON plan, tolerating prose or code fences around the object. */
export function parsePlan(raw: string, kind: PieceKind, provider: Provider): Plan {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  let json: unknown
  try {
    json = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : undefined
  } catch {
    json = undefined
  }
  const parsed = PlanSchema.safeParse(json)
  if (!parsed.success) throw new ProviderError('invalid_output', provider, 'plan is not a JSON object with string keys')

  const imagePrompt = kind === 'texto' ? null : parsed.data.image_prompt?.trim() || null
  const caption = kind === 'imagem' ? null : parsed.data.caption?.trim() || null
  if (kind !== 'texto' && !imagePrompt) throw new ProviderError('invalid_output', provider, 'plan is missing image_prompt')
  if (kind !== 'imagem' && !caption) throw new ProviderError('invalid_output', provider, 'plan is missing caption')
  return { imagePrompt, caption }
}

export async function planRound(o: {
  text: TextProvider
  provider: Provider
  key: string
  model: string
  effort: string | null
  ctx: PieceContext
  batch: InboxMessage[]
  referenceCount: number
  hasCurrentImage: boolean
  signal: AbortSignal
}): Promise<Plan> {
  const prompt = buildOrchestratorPrompt(o.ctx, o.batch, o.referenceCount, o.hasCurrentImage)
  const req = { model: o.model, system: ORCHESTRATOR_SYSTEM, prompt, maxOutputTokens: MAX_OUTPUT_TOKENS, ...(o.effort && { effort: o.effort }) }
  const raw = await o.text.generateText(o.key, req, o.signal)
  return parsePlan(raw, o.ctx.piece.kind, o.provider)
}
