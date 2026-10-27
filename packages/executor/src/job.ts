import { randomUUID } from 'node:crypto'
import type { PieceKind, PieceStatus, Provider } from '@sala/shared'
import {
  agentErrorMessage, findModel, MODEL_CATALOG, ModelChoiceSchema, type AgentErrorInput, type CatalogModel, type ModelCapability,
} from '@sala/shared/agent'
import { ClaimLostError, type ExecutorDb, type HistoryMessage, type InboxMessage } from './db.ts'
import type { Logger } from './log.ts'
import { planRound, type Plan } from './orchestrator.ts'
import { redact } from './providers/http.ts'
import { ProviderError, type GeneratedImage, type InputImage, type Providers } from './providers/types.ts'

export type JobDeps = { db: ExecutorDb; providers: Providers; log: Logger; touchIntervalMs: number; textTimeoutMs: number; imageTimeoutMs: number }
export type RoundOutcome = 'ok' | 'failed' | 'claim_lost'

type Models = { text: CatalogModel; image: CatalogModel | null }

const AGENT_STATUSES: readonly PieceStatus[] = ['gerando', 'base_em_revisao']
const EXTENSIONS: Record<GeneratedImage['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const redactAll = (text: string, keys: string[]) => keys.reduce(redact, text)

/**
 * Picks the text model (always) and the image model (imagem and imagem_texto pieces).
 * The choice is the latest non-null `model` of the batch, else of the history.
 * Without a choice for a capability, the first catalog model whose provider has a key.
 */
export function resolveModels(kind: PieceKind, batch: InboxMessage[], history: HistoryMessage[], keyed: Provider[]): Models | AgentErrorInput {
  const latest = (list: unknown[]) => list.findLast((v) => v != null)
  const chosen = latest(batch.map((m) => m.body.model)) ?? latest(history.map((m) => m.model))

  const parsed = ModelChoiceSchema.safeParse(chosen ?? {})
  if (!parsed.success) {
    // shortcut: the malformed choice has no readable model name, so the copy names none.
    return { code: 'invalid_model', model: '(inválido)', capability: 'text' }
  }

  const pick = (capability: ModelCapability): CatalogModel | AgentErrorInput => {
    const ref = parsed.data[capability]
    if (ref) {
      const model = findModel(ref, capability)
      if (!model) return { code: 'invalid_model', model: ref.model, capability }
      return keyed.includes(model.provider) ? model : { code: 'missing_key', provider: model.provider }
    }
    return MODEL_CATALOG.find((m) => m.capability === capability && keyed.includes(m.provider)) ?? { code: 'missing_key', capability }
  }

  const text = pick('text')
  if ('code' in text) return text
  if (kind === 'texto') return { text, image: null }
  const image = pick('image')
  return 'code' in image ? image : { text, image }
}

/** Runs one round for `batch`: plan, generate, store the version, post the events. */
async function runRound(deps: JobDeps, batch: InboxMessage[], round: number): Promise<RoundOutcome> {
  const { db, log } = deps
  const last = batch[batch.length - 1]!
  const sourceId = last.id
  const pieceId = last.piece_id
  const messageIds = batch.map((m) => m.id)
  const keys: string[] = []
  let plan: Plan | null = null

  const fail = async (input: AgentErrorInput): Promise<RoundOutcome> => {
    try {
      await db.addAgentEvent(sourceId, 'agent_error', {
        message_ids: messageIds, round, code: input.code, message: agentErrorMessage(input), image_prompt: plan?.imagePrompt ?? null,
      })
      return 'failed'
    } catch (e) {
      if (e instanceof ClaimLostError) return claimLost(e)
      log.error('agent_error event failed', { piece_id: pieceId, round, error: redactAll(errorText(e), keys) })
      return 'failed'
    }
  }
  const claimLost = (e: ClaimLostError): RoundOutcome => {
    log.warn('claim lost', { piece_id: pieceId, round, error: e.message })
    return 'claim_lost'
  }

  try {
    const ctx = await db.loadPieceContext(pieceId)
    if (!AGENT_STATUSES.includes(ctx.piece.status)) return await fail({ code: 'wrong_status', status: ctx.piece.status })

    const models = resolveModels(ctx.piece.kind, batch, ctx.history, ctx.keyedProviders)
    if ('code' in models) return await fail(models)

    const keyOf = async (provider: Provider) => {
      const key = await db.getProviderKey(ctx.piece.team_id, provider)
      if (key) keys.push(key)
      return key
    }
    const textKey = await keyOf(models.text.provider)
    if (!textKey) return await fail({ code: 'missing_key', provider: models.text.provider })
    const imageKey = models.image && (await keyOf(models.image.provider))
    if (models.image && !imageKey) return await fail({ code: 'missing_key', provider: models.image.provider })

    // Input images: current version first, then the batch references (or the latest ones in the history).
    const images: InputImage[] = []
    let referenceCount = 0
    let dropped: string[] = []
    const hasCurrentImage = !!(models.image && ctx.latestVersion?.image_path)
    if (models.image) {
      if (hasCurrentImage) images.push(await db.downloadFile(ctx.latestVersion!.image_path!))
      let refIds = [...new Set(batch.flatMap((m) => m.body.reference_asset_ids))]
      if (refIds.length === 0) refIds = ctx.history.findLast((m) => m.reference_asset_ids.length > 0)?.reference_asset_ids ?? []
      const refs = await db.loadReferencePaths(ctx.piece.team_id, ctx.piece.campaign_id, refIds)
      const room = Math.max(0, models.image.maxReferenceImages - images.length)
      dropped = refs.slice(room).map((r) => r.id)
      for (const r of refs.slice(0, room)) images.push(await db.downloadFile(r.storage_path))
      referenceCount = Math.min(refs.length, room)
    }

    const ref = (m: CatalogModel | null) => (m ? { provider: m.provider, model: m.model } : null)
    await db.addAgentEvent(sourceId, 'agent_started', {
      message_ids: messageIds, round, models: { text: ref(models.text), image: ref(models.image) },
      reference_count: referenceCount, dropped_reference_ids: dropped,
    })

    const textProvider = deps.providers.text[models.text.provider]
    if (!textProvider) throw new Error(`no text adapter for ${models.text.provider}`)
    plan = await planRound({
      text: textProvider, provider: models.text.provider, key: textKey, model: models.text.model, ctx, batch,
      referenceCount: images.length, hasCurrentImage, signal: AbortSignal.timeout(deps.textTimeoutMs),
    })

    let path: string | null = null
    if (models.image && imageKey && plan.imagePrompt) {
      const imageProvider = deps.providers.image[models.image.provider]
      if (!imageProvider) throw new Error(`no image adapter for ${models.image.provider}`)
      const generated = await imageProvider.generateImage(
        imageKey, { model: models.image.model, prompt: plan.imagePrompt, images }, AbortSignal.timeout(deps.imageTimeoutMs),
      )
      path = `${ctx.piece.team_id}/${ctx.piece.id}/${randomUUID()}.${EXTENSIONS[generated.mimeType]}`
      await db.uploadFile(path, generated.bytes, generated.mimeType)
    }

    let version: { id: string; number: number }
    try {
      version = await db.addAgentVersion(ctx.piece.id, path, plan.caption, sourceId)
    } catch (e) {
      const removeUploaded = async () => {
        if (path) await db.removeFile(path).catch((re) => log.error('remove file failed', { path, error: errorText(re) }))
      }
      // The RPC raised inside its transaction: nothing was stored.
      if (e instanceof ClaimLostError) {
        await removeUploaded()
        return claimLost(e)
      }
      // A network error can hide a commit. If the check itself fails, the file stays: an orphan file beats a version without its image.
      if ((await db.answeredMessages(ctx.piece.id, [sourceId])).has(sourceId)) {
        log.warn('version stored despite the error', { piece_id: pieceId, round, error: errorText(e) })
        return 'ok'
      }
      await removeUploaded()
      // Someone approved or stepped back while the image was generating.
      const { status } = (await db.loadPieceContext(ctx.piece.id)).piece
      if (!AGENT_STATUSES.includes(status)) return await fail({ code: 'wrong_status', status })
      throw e
    }

    await db.addAgentEvent(sourceId, 'agent_result', {
      message_ids: messageIds, round, version_id: version.id, version_number: version.number, image_prompt: plan.imagePrompt,
    })
    return 'ok'
  } catch (e) {
    if (e instanceof ClaimLostError) return claimLost(e)
    if (e instanceof ProviderError) {
      const detail = redactAll(e.detail, keys)
      log.warn('provider failed', { piece_id: pieceId, round, provider: e.provider, code: e.code, detail })
      return await fail(e.code === 'provider_error' ? { code: e.code, provider: e.provider, detail } : { code: e.code, provider: e.provider })
    }
    log.error('round failed', { piece_id: pieceId, round, error: redactAll(errorText(e), keys) })
    return await fail({ code: 'internal' })
  }
}

/**
 * Serves one claim: rounds run while redirections keep arriving. Never throws.
 * Round errors become an agent_error inside runRound. A queue error (absorb or
 * complete) is only logged: the messages stay claimed until release_stale_claims
 * requeues them, and answeredMessages keeps a stored version from being made again.
 */
export async function processClaim(deps: JobDeps, first: InboxMessage, signal?: AbortSignal): Promise<void> {
  const { db, log } = deps
  const pieceId = first.piece_id
  const timer = setInterval(() => {
    db.touchClaim(pieceId).catch((e) => log.warn('touch claim failed', { piece_id: pieceId, error: errorText(e) }))
  }, deps.touchIntervalMs)
  try {
    let batch = [first, ...(await db.absorbPending(pieceId))]
    for (let round = 1; ; round++) {
      // Messages answered by a version of an earlier claim are completed without a new round.
      const answered = await db.answeredMessages(pieceId, batch.map((m) => m.id))
      const todo = batch.filter((m) => !answered.has(m.id))
      const outcome = todo.length > 0 ? await runRound(deps, todo, round) : 'ok'
      if (outcome === 'claim_lost') return
      if (outcome === 'failed') {
        for (const m of batch) await db.complete(m.id, answered.has(m.id) ? 'done' : 'failed')
        return
      }
      // Absorb before completing: the piece is never left without a claim between rounds.
      // After an abort, new messages stay queued for the next executor instead of starting another round.
      const next = signal?.aborted ? [] : await db.absorbPending(pieceId)
      for (const m of batch) await db.complete(m.id, 'done')
      if (next.length === 0) return
      batch = next
    }
  } catch (e) {
    // No agent_error here: the round may already have posted its result.
    if (e instanceof ClaimLostError) log.warn('claim lost', { piece_id: pieceId, error: e.message })
    else log.error('claim failed', { piece_id: pieceId, error: errorText(e) })
  } finally {
    clearInterval(timer)
  }
}
