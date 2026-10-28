import { MAX_DETAIL, postJson, redact } from './http.ts'
import { checkRequestSize, decodeImage } from './image.ts'
import { type ImageProvider, ProviderError } from './types.ts'

/** The declared mime type is ignored: decodeImage reads the type from the bytes. */
type InlineData = { data?: unknown }
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
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          // generateContent takes the ThinkingLevel enum name (MINIMAL, MEDIUM, HIGH); the catalog keeps the lowercase effort.
          ...(req.effort && { thinkingConfig: { thinkingLevel: req.effort.toUpperCase() } }),
        },
      }
      // Gemini rejects inline requests over 20 MB with an English 400; fail first, without spending a call.
      checkRequestSize(body, 'gemini', 'Gemini')

      const reply = await postJson({
        provider: 'gemini',
        url: `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(req.model)}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body,
        key, signal, fetchFn,
        // A generation lost to a network error may still be billed: never repeat it.
        idempotent: false,
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

      return decodeImage((image.inlineData ?? image.inline_data)!.data, 'gemini')
    },
  }
}
