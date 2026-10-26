import { isBase64, postJson, redact } from './http.ts'
import { type GeneratedImage, type ImageProvider, ProviderError } from './types.ts'

const MAX_DETAIL = 300
/** The `multi` endpoint requires `image_urls`, so a request without references goes here instead. */
const TEXT_TO_IMAGE_MODEL = 'fal-ai/flux-pro/kontext/max/text-to-image'
const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'] satisfies GeneratedImage['mimeType'][]
const DATA_URI = /^data:([^;,]+);base64,(.*)$/s

type FalReply = { images?: { url?: unknown; content_type?: unknown }[] }

/** Same limit as the `team-files` bucket (migration 0002): a larger image could never be stored. */
const MAX_IMAGE_BYTES = 26_214_400
/** Request cap with the references inlined. fal publishes none; same decimal 20 MB as Gemini. */
const MAX_REQUEST_BYTES = 20_000_000

const invalid = (detail: string) => new ProviderError('invalid_output', 'fal', detail)
const tooLarge = () => invalid(`image larger than ${MAX_IMAGE_BYTES} bytes`)

function checkType(mimeType: unknown, key: string): GeneratedImage['mimeType'] {
  if (typeof mimeType !== 'string' || !IMAGE_TYPES.includes(mimeType)) {
    throw invalid(`unsupported image type: ${redact(String(mimeType), key).slice(0, 100)}`)
  }
  return mimeType as GeneratedImage['mimeType']
}

/**
 * fal Flux Kontext: prompt plus reference images in, one image out. References go as data URIs,
 * never as signed Storage links, so no private team file becomes reachable by URL.
 */
export function createFal(fetchFn: typeof fetch): ImageProvider {
  return {
    async generateImage(key, req, signal) {
      const withImages = req.images.length > 0
      const model = withImages ? req.model : TEXT_TO_IMAGE_MODEL
      const body = {
        prompt: req.prompt,
        ...(withImages && { image_urls: req.images.map((i) => `data:${i.mimeType};base64,${Buffer.from(i.bytes).toString('base64')}`) }),
        sync_mode: true,
        output_format: 'png',
      }
      // fal documents no request cap; refuse oversized data URIs before spending (and retrying) a call.
      const size = Buffer.byteLength(JSON.stringify(body))
      if (size > MAX_REQUEST_BYTES) {
        const mb = (size / 1_000_000).toFixed(1).replace('.', ',')
        throw new ProviderError('provider_error', 'fal',
          `as imagens de referência somam ${mb} MB; o limite do Flux Kontext é 20 MB por pedido. Use menos imagens ou imagens menores.`)
      }

      const reply = await postJson({
        provider: 'fal',
        // Model ids are paths (`fal-ai/flux-pro/...`): encode each segment, keep the slashes.
        url: `https://fal.run/${model.split('/').map(encodeURIComponent).join('/')}`,
        headers: { authorization: `Key ${key}` },
        body,
        key, signal, fetchFn,
      }) as FalReply | null

      const image = reply?.images?.[0]
      const url = image?.url
      if (typeof url !== 'string' || !url) throw invalid('no image in response')

      const data = DATA_URI.exec(url)
      if (data) {
        const mimeType = checkType(data[1], key)
        if (!data[2]) throw invalid('empty image data')
        if (!isBase64(data[2])) throw invalid('invalid base64 image data')
        return { bytes: new Uint8Array(Buffer.from(data[2], 'base64')), mimeType }
      }

      // Only https: anything else (http, file, internal hosts by scheme) is never fetched.
      if (!url.startsWith('https://')) throw invalid('image url is neither https nor a data URI')
      // The file comes from a second request: its own bytes say what it is, not the JSON's content_type.
      const bytes = await download(url, key, signal, fetchFn)
      const mimeType = sniffType(bytes)
      if (!mimeType) throw invalid('downloaded file is not a PNG, JPEG or WebP image')
      return { bytes, mimeType }
    },
  }
}

/** The image type from the file signature, or undefined when it is not PNG, JPEG or WebP. */
function sniffType(b: Uint8Array): GeneratedImage['mimeType'] | undefined {
  const at = (offset: number, sig: number[]) => sig.every((v, i) => b[offset + i] === v)
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp' // RIFF....WEBP
  return undefined
}

/** GETs the generated file. No auth header: the fal CDN link is public and must never see the key. */
async function download(url: string, key: string, signal: AbortSignal, fetchFn: typeof fetch): Promise<Uint8Array> {
  const fail = (detail: string) => new ProviderError('provider_error', 'fal', redact(detail, key).slice(0, MAX_DETAIL))
  try {
    // A redirect could lead to http or an internal host, bypassing the https-only check in generateImage.
    const res = await fetchFn(url, { method: 'GET', redirect: 'error', signal })
    if (!res.ok) throw fail(`image download failed: HTTP ${res.status}`)
    if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await res.body?.cancel()
      throw tooLarge()
    }
    // Read in chunks and stop at the limit, so an oversized or endless body never fills memory.
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of res.body ?? []) {
      total += chunk.length
      if (total > MAX_IMAGE_BYTES) throw tooLarge() // leaving the loop cancels the stream
      chunks.push(chunk)
    }
    if (total === 0) throw invalid('empty image data')
    return new Uint8Array(Buffer.concat(chunks, total))
  } catch (err) {
    if (err instanceof ProviderError) throw err
    // Same rule as postJson: only a deadline is a provider timeout; any other abort keeps its reason.
    if (signal.aborted) {
      throw (signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError'
        ? new ProviderError('timeout', 'fal', 'timeout')
        : signal.reason
    }
    throw fail(`image download failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
