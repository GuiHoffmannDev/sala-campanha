import type { Provider } from '@sala/shared'

export type TextRequest = { model: string; system: string; prompt: string; maxOutputTokens: number }
export type TextProvider = { generateText(key: string, req: TextRequest, signal: AbortSignal): Promise<string> }

export type InputImage = { bytes: Uint8Array; mimeType: string }
export type ImageRequest = { model: string; prompt: string; images: InputImage[] }
export type GeneratedImage = { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }
export type ImageProvider = { generateImage(key: string, req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> }

export type Providers = { text: Partial<Record<Provider, TextProvider>>; image: Partial<Record<Provider, ImageProvider>> }

export type ProviderErrorCode = 'provider_error' | 'timeout' | 'invalid_output'

/** A provider call that failed. `detail` must already be redacted: it can reach logs and chat events. */
export class ProviderError extends Error {
  code: ProviderErrorCode
  provider: Provider
  detail: string

  constructor(code: ProviderErrorCode, provider: Provider, detail: string) {
    super(`${provider} ${code}: ${detail}`)
    this.name = 'ProviderError'
    this.code = code
    this.provider = provider
    this.detail = detail
  }
}
