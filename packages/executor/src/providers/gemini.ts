import { postJson, redact } from './http.ts'
import { type GeneratedImage, type ImageProvider, ProviderError } from './types.ts'

const MAX_DETAIL = 300
const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'] satisfies GeneratedImage['mimeType'][]

type InlineData = { mimeType?: string; mime_type?: string; data?: string }
type Part = { text?: string; thought?: boolean; inlineData?: InlineData; inline_data?: InlineData }
type GenerateContentReply = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

/** Gemini `generateContent` (Nano Banana): prompt plus reference images in, one image out. */
export function createGemini(fetchFn: typeof fetch): ImageProvider {
  return {
    async generateImage(key, req, signal) {
      const reply = await postJson({
        provider: 'gemini',
        url: `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(req.model)}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body: {
          contents: [{ parts: [
            { text: req.prompt },
            ...req.images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: Buffer.from(i.bytes).toString('base64') } })),
          ] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        },
        key, signal, fetchFn,
      }) as GenerateContentReply | null

      const candidate = reply?.candidates?.[0]
      const parts = candidate?.content?.parts ?? []
      // Thinking models may return draft images marked `thought`; only the final image counts.
      const image = parts.find((p) => !p.thought && (p.inlineData ?? p.inline_data))
      if (!image) {
        // Usually a refusal: the model explains in text, or only a finish/block reason comes back.
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join(' ').trim()
        const detail = text || candidate?.finishReason || reply?.promptFeedback?.blockReason || 'no image in response'
        throw new ProviderError('provider_error', 'gemini', redact(detail, key).slice(0, MAX_DETAIL))
      }

      const inline = (image.inlineData ?? image.inline_data)!
      const mimeType = inline.mimeType ?? inline.mime_type
      if (!mimeType || !IMAGE_TYPES.includes(mimeType)) {
        throw new ProviderError('invalid_output', 'gemini', `unsupported image type: ${redact(String(mimeType), key).slice(0, 100)}`)
      }
      const bytes = typeof inline.data === 'string' ? Buffer.from(inline.data, 'base64') : undefined
      if (!bytes?.length) throw new ProviderError('invalid_output', 'gemini', 'empty image data')
      return { bytes: new Uint8Array(bytes), mimeType: mimeType as GeneratedImage['mimeType'] }
    },
  }
}
