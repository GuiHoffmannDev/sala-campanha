import { postJson, redact } from './http.ts'
import { type GeneratedImage, type ImageProvider, ProviderError } from './types.ts'

const MAX_DETAIL = 300
/** Gemini's cap on a request with inline data. Decimal megabytes: the stricter reading of "20 MB". */
const MAX_REQUEST_BYTES = 20_000_000
const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'] satisfies GeneratedImage['mimeType'][]
/**
 * Standard padded base64, as the API encodes bytes; Buffer.from would silently skip anything else.
 * Plain character class plus a length check: a repeated group overflows the regex stack on multi-MB images.
 */
const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/
const isBase64 = (s: string) => s.length % 4 === 0 && BASE64_CHARS.test(s)

type InlineData = { mimeType?: string; mime_type?: string; data?: string }
type Part = { text?: string; thought?: boolean; inlineData?: InlineData; inline_data?: InlineData }
type GenerateContentReply = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

/** Portuguese text for the finish or block reasons that mean the request was refused. */
const REFUSAL_REASONS: Record<string, string> = {
  SAFETY: 'pedido bloqueado pelo filtro de segurança',
  IMAGE_SAFETY: 'imagem bloqueada pelo filtro de segurança',
  PROHIBITED_CONTENT: 'conteúdo proibido pela política do Gemini',
  IMAGE_PROHIBITED_CONTENT: 'conteúdo proibido pela política do Gemini',
  BLOCKLIST: 'termo bloqueado pela lista do Gemini',
  RECITATION: 'resultado parecido demais com conteúdo protegido',
  IMAGE_RECITATION: 'resultado parecido demais com conteúdo protegido',
  SPII: 'dado pessoal sensível no pedido',
}

/** Readable detail for a reply with no image and no model text. The raw reason stays in parentheses for debugging. */
function describeReason(reason: string | undefined): string {
  const text = (reason && Object.hasOwn(REFUSAL_REASONS, reason) ? REFUSAL_REASONS[reason] : undefined) ?? 'o modelo não devolveu imagem'
  return reason ? `${text} (${reason})` : text
}

/** Gemini `generateContent` (Nano Banana): prompt plus reference images in, one image out. */
export function createGemini(fetchFn: typeof fetch): ImageProvider {
  return {
    async generateImage(key, req, signal) {
      const body = {
        contents: [{ parts: [
          { text: req.prompt },
          ...req.images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: Buffer.from(i.bytes).toString('base64') } })),
        ] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }
      // Gemini rejects inline requests over 20 MB with an English 400; fail first, without spending a call.
      const size = Buffer.byteLength(JSON.stringify(body))
      if (size > MAX_REQUEST_BYTES) {
        const mb = (size / 1_000_000).toFixed(1).replace('.', ',')
        throw new ProviderError('provider_error', 'gemini',
          `as imagens de referência somam ${mb} MB; o limite do Gemini é 20 MB por pedido. Use menos imagens ou imagens menores.`)
      }

      const reply = await postJson({
        provider: 'gemini',
        url: `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(req.model)}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body,
        key, signal, fetchFn,
      }) as GenerateContentReply | null

      const candidate = reply?.candidates?.[0]
      const parts = candidate?.content?.parts ?? []
      // Thinking models may return draft images marked `thought`; only the final image counts.
      const image = parts.find((p) => !p.thought && (p.inlineData ?? p.inline_data))
      if (!image) {
        // Usually a refusal: the model explains in text, or only a finish/block reason comes back.
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join(' ').trim()
        const detail = text || describeReason(candidate?.finishReason || reply?.promptFeedback?.blockReason)
        throw new ProviderError('provider_error', 'gemini', redact(detail, key).slice(0, MAX_DETAIL))
      }

      const inline = (image.inlineData ?? image.inline_data)!
      const mimeType = inline.mimeType ?? inline.mime_type
      if (!mimeType || !IMAGE_TYPES.includes(mimeType)) {
        throw new ProviderError('invalid_output', 'gemini', `unsupported image type: ${redact(String(mimeType), key).slice(0, 100)}`)
      }
      if (!inline.data) throw new ProviderError('invalid_output', 'gemini', 'empty image data')
      if (typeof inline.data !== 'string' || !isBase64(inline.data)) throw new ProviderError('invalid_output', 'gemini', 'invalid base64 image data')
      const bytes = Buffer.from(inline.data, 'base64')
      return { bytes: new Uint8Array(bytes), mimeType: mimeType as GeneratedImage['mimeType'] }
    },
  }
}
