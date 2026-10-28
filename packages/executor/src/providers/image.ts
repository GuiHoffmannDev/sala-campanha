import type { Provider } from '@sala/shared'
import { isBase64 } from './http.ts'
import { type GeneratedImage, MAX_IMAGE_BYTES, ProviderError } from './types.ts'

/** Base64 length of a MAX_IMAGE_BYTES image: a longer string always decodes to a larger file. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
/** Gemini's cap on a request with inline data; fal publishes none and gets the same. Decimal megabytes: the stricter reading of "20 MB". */
const MAX_REQUEST_BYTES = 20_000_000

/** The image type from the file signature, or undefined when it is not PNG, JPEG or WebP. */
export function sniffType(b: Uint8Array): GeneratedImage['mimeType'] | undefined {
  const at = (offset: number, sig: number[]) => sig.every((v, i) => b[offset + i] === v)
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp' // RIFF....WEBP
  return undefined
}

/**
 * Decodes an image a provider returned in base64. The type comes from the bytes, never from
 * the label the provider declared, and the file is at most MAX_IMAGE_BYTES. Any failure is invalid_output.
 */
export function decodeImage(base64: unknown, provider: Provider): GeneratedImage {
  const invalid = (detail: string) => new ProviderError('invalid_output', provider, detail)
  const tooLarge = () => invalid(`image larger than ${MAX_IMAGE_BYTES} bytes`)
  if (typeof base64 !== 'string') throw invalid('image data is not a string')
  if (!base64) throw invalid('empty image data')
  // Checked before decoding, so an oversized string is never copied into a buffer.
  if (base64.length > MAX_BASE64_LENGTH) throw tooLarge()
  if (!isBase64(base64)) throw invalid('invalid base64 image data')
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (bytes.length > MAX_IMAGE_BYTES) throw tooLarge()
  const mimeType = sniffType(bytes)
  if (!mimeType) throw invalid('image is not a PNG, JPEG or WebP file')
  return { bytes, mimeType }
}

/** Refuses a request over 20 MB with readable Portuguese, before spending a call. `label` names the model family. */
export function checkRequestSize(body: unknown, provider: Provider, label: string): void {
  const size = Buffer.byteLength(JSON.stringify(body))
  if (size <= MAX_REQUEST_BYTES) return
  const mb = (size / 1_000_000).toFixed(1).replace('.', ',')
  throw new ProviderError('provider_error', provider,
    `as imagens de referência somam ${mb} MB; o limite do ${label} é 20 MB por pedido. Use menos imagens ou imagens menores.`)
}
