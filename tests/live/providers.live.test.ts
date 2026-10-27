// Optional smoke test against the real provider APIs. Each provider runs only
// when its LIVE_<PROVIDER>_KEY is set; without any, the whole file is skipped and
// `pnpm test` makes no network calls. The keys are never printed.
import { crc32, deflateSync } from 'node:zlib'
import { MODEL_CATALOG, type ModelCapability } from '../../packages/shared/src/agent.ts'
import type { Provider } from '../../packages/shared/src/domain.ts'
import { parsePlan } from '../../packages/executor/src/orchestrator.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'

const providers = createProviders()
const TIMEOUT_MS = 180_000

function liveKey(provider: Provider): string | undefined {
  return process.env[`LIVE_${provider.toUpperCase()}_KEY`] || undefined
}

function catalogModel(provider: Provider, capability: ModelCapability): string {
  const found = MODEL_CATALOG.find(m => m.provider === provider && m.capability === capability)
  if (!found) throw new Error(`no ${capability} model for ${provider} in MODEL_CATALOG`)
  return found.model
}

/** A small solid-colour RGB PNG, built in memory so the test needs no fixture file. */
function solidPng(size: number, [r, g, b]: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3]!)])
  const pixels = Buffer.concat(Array.from({ length: size }, () => row))
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

for (const provider of ['anthropic', 'openai'] as const) {
  const key = liveKey(provider)
  describe.skipIf(!key)(`live text: ${provider}`, () => {
    it('returns a caption plan that parsePlan accepts', async () => {
      const raw = await providers.text[provider]!.generateText(
        key!,
        {
          model: catalogModel(provider, 'text'),
          system: 'Responda somente com um objeto JSON, sem texto em volta.',
          prompt: 'Devolva {"caption":"..."} com uma legenda curta para um post de lançamento de garrafa térmica.',
          maxOutputTokens: 300,
        },
        AbortSignal.timeout(TIMEOUT_MS),
      )
      const plan = parsePlan(raw, 'texto', provider)
      expect(plan.caption).toBeTruthy()
    }, TIMEOUT_MS)
  })
}

for (const provider of ['gemini', 'fal'] as const) {
  const key = liveKey(provider)
  describe.skipIf(!key)(`live image: ${provider}`, () => {
    it('generates one image from one PNG reference', async () => {
      const image = await providers.image[provider]!.generateImage(
        key!,
        {
          model: catalogModel(provider, 'image'),
          prompt: 'Use the reference colour as the background of a simple flat illustration of a thermos bottle.',
          images: [{ bytes: solidPng(64, [30, 120, 200]), mimeType: 'image/png' }],
        },
        AbortSignal.timeout(TIMEOUT_MS),
      )
      expect(['image/png', 'image/jpeg', 'image/webp']).toContain(image.mimeType)
      expect(image.bytes.length).toBeGreaterThan(0)
    }, TIMEOUT_MS)
  })
}
