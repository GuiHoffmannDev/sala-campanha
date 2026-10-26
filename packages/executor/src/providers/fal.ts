import { isBase64, postJson, redact } from './http.ts'
import { type GeneratedImage, type ImageProvider, ProviderError } from './types.ts'

const MAX_DETAIL = 300
/** The `multi` endpoint requires `image_urls`, so a request without references goes here instead. */
const TEXT_TO_IMAGE_MODEL = 'fal-ai/flux-pro/kontext/max/text-to-image'
const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'] satisfies GeneratedImage['mimeType'][]
const DATA_URI = /^data:([^;,]+);base64,(.*)$/s

type FalReply = { images?: { url?: unknown; content_type?: unknown }[] }

const invalid = (detail: string) => new ProviderError('invalid_output', 'fal', detail)

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
      const reply = await postJson({
        provider: 'fal',
        // Model ids are paths (`fal-ai/flux-pro/...`): encode each segment, keep the slashes.
        url: `https://fal.run/${model.split('/').map(encodeURIComponent).join('/')}`,
        headers: { authorization: `Key ${key}` },
        body: {
          prompt: req.prompt,
          ...(withImages && { image_urls: req.images.map((i) => `data:${i.mimeType};base64,${Buffer.from(i.bytes).toString('base64')}`) }),
          sync_mode: true,
          output_format: 'png',
        },
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
      const mimeType = checkType(image?.content_type, key)
      return { bytes: await download(url, key, signal, fetchFn), mimeType }
    },
  }
}

/** GETs the generated file. No auth header: the fal CDN link is public and must never see the key. */
async function download(url: string, key: string, signal: AbortSignal, fetchFn: typeof fetch): Promise<Uint8Array> {
  const fail = (detail: string) => new ProviderError('provider_error', 'fal', redact(detail, key).slice(0, MAX_DETAIL))
  try {
    const res = await fetchFn(url, { method: 'GET', signal })
    if (!res.ok) throw fail(`image download failed: HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0) throw invalid('empty image data')
    return bytes
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
