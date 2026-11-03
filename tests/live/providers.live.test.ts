// Optional smoke test against the real provider APIs: one case per MODEL_CATALOG model,
// at the model's lowest reasoning effort when it has one. Each provider runs only when its
// LIVE_<PROVIDER>_KEY is set; without any, the whole file is skipped and `pnpm test` makes
// no network calls. The keys are never printed.
import { solidPng } from '../helpers/images.ts'
import { MODEL_CATALOG, type CatalogModel } from '../../packages/shared/src/agent.ts'
import type { Provider } from '../../packages/shared/src/domain.ts'
import { MAX_OUTPUT_TOKENS, parsePlan } from '../../packages/executor/src/orchestrator.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'
import type { ImageProvider, InputImage } from '../../packages/executor/src/providers/types.ts'

const providers = createProviders()
// The executor's default TEXT_TIMEOUT_MS and IMAGE_TIMEOUT_MS.
const TEXT_TIMEOUT_MS = 240_000
const IMAGE_TIMEOUT_MS = 300_000

function liveKey(provider: Provider): string | undefined {
  return process.env[`LIVE_${provider.toUpperCase()}_KEY`] || undefined
}

/** The first (lowest) effort of the catalog list, or no effort when the model has no effort control. */
function lowestEffort(model: CatalogModel): { effort?: string } {
  return model.efforts.length > 0 ? { effort: model.efforts[0] } : {}
}

type ReplyPart = { thought?: boolean; inlineData?: unknown; inline_data?: unknown }

/**
 * fetch that logs each reply's size in bytes and how many draft (`thought`) image parts it
 * carries. MAX_RESPONSE_BYTES in http.ts leaves no room for draft images, so a non-zero count
 * is a follow-up. Only the size, status and count are printed, never the body or the key.
 */
function measuringFetch(label: string): typeof fetch {
  return async (input, init) => {
    const res = await fetch(input, init)
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    let thoughtImages = 0
    try {
      const reply = JSON.parse(new TextDecoder().decode(bytes)) as { candidates?: { content?: { parts?: ReplyPart[] } }[] }
      thoughtImages = (reply.candidates ?? [])
        .flatMap((c) => c.content?.parts ?? [])
        .filter((p) => p.thought && (p.inlineData || p.inline_data)).length
    } catch {
      // Not JSON (an error page): no parts to count.
    }
    console.info(`${label}: HTTP ${res.status}, ${bytes.length} bytes, ${thoughtImages} thought image part(s)`)
    return res
  }
}

for (const model of MODEL_CATALOG.filter((m) => m.capability === 'text')) {
  const key = liveKey(model.provider)
  describe.skipIf(!key)(`live text: ${model.label}`, () => {
    it('returns a caption plan that parsePlan accepts', async () => {
      const raw = await providers.text[model.provider]!.generateText(
        key!,
        {
          model: model.model,
          system: 'Responda somente com um objeto JSON, sem texto em volta.',
          prompt: 'Devolva {"caption":"..."} com uma legenda curta para um post de lançamento de garrafa térmica.',
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...lowestEffort(model),
        },
        AbortSignal.timeout(TEXT_TIMEOUT_MS),
      )
      expect(parsePlan(raw, 'texto', model.provider).caption).toBeTruthy()
    }, TEXT_TIMEOUT_MS + 10_000)
  })
}

const withReference = {
  name: 'one PNG reference',
  prompt: 'Use the reference colour as the background of a simple flat illustration of a thermos bottle.',
  images: [{ bytes: solidPng(64, [30, 120, 200]), mimeType: 'image/png' }] as InputImage[],
}
// fal sends a request without references to its text-to-image endpoint instead of `multi`.
const withoutReference = {
  name: 'no reference (text-to-image endpoint)',
  prompt: 'A simple flat illustration of a blue thermos bottle on a plain white background.',
  images: [] as InputImage[],
}

for (const model of MODEL_CATALOG.filter((m) => m.capability === 'image')) {
  const key = liveKey(model.provider)
  const adapter: ImageProvider =
    model.provider === 'gemini' ? createProviders(measuringFetch(model.label)).image.gemini! : providers.image[model.provider]!
  const cases = model.provider === 'fal' ? [withReference, withoutReference] : [withReference]
  describe.skipIf(!key)(`live image: ${model.label}`, () => {
    for (const c of cases) {
      it(`generates one image from ${c.name}`, async () => {
        const image = await adapter.generateImage(
          key!,
          { model: model.model, prompt: c.prompt, images: c.images, ...lowestEffort(model) },
          AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        )
        expect(['image/png', 'image/jpeg', 'image/webp']).toContain(image.mimeType)
        expect(image.bytes.length).toBeGreaterThan(0)
      }, IMAGE_TIMEOUT_MS + 10_000)
    }
  })
}
