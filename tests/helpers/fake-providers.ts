import type { GeneratedImage, ImageRequest, ProviderError, Providers, TextRequest } from '../../packages/executor/src/providers/types.ts'

export const FAKE_PLAN = JSON.stringify({ image_prompt: 'A blue banner with the product', caption: 'Legenda do agente' })
// PNG signature: enough for Storage and for any check that sniffs the type.
export const FAKE_IMAGE: GeneratedImage = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimeType: 'image/png' }

/**
 * Providers that never touch the network. Registers anthropic/openai as text and
 * gemini/fal as image, and records every request in call order.
 */
export function fakeProviders(o: {
  plan?: string | (() => Promise<string>)
  image?: () => Promise<GeneratedImage>
  textError?: ProviderError
} = {}): { providers: Providers; calls: { text: TextRequest[]; image: ImageRequest[] } } {
  const calls = { text: [] as TextRequest[], image: [] as ImageRequest[] }
  const text = {
    async generateText(_key: string, req: TextRequest) {
      calls.text.push(req)
      if (o.textError) throw o.textError
      return typeof o.plan === 'function' ? o.plan() : (o.plan ?? FAKE_PLAN)
    },
  }
  const image = {
    async generateImage(_key: string, req: ImageRequest) {
      calls.image.push(req)
      return o.image ? o.image() : FAKE_IMAGE
    },
  }
  return { providers: { text: { anthropic: text, openai: text }, image: { gemini: image, fal: image } }, calls }
}
