import { abortError, MAX_DETAIL, postJson, readCapped, redact } from './http.ts'
import { checkRequestSize, decodeImage, sniffType } from './image.ts'
import { type ImageProvider, MAX_IMAGE_BYTES, ProviderError } from './types.ts'

/** The `multi` endpoint requires `image_urls`, so a request without references goes here instead. */
const TEXT_TO_IMAGE_MODEL = 'fal-ai/flux-pro/kontext/max/text-to-image'
/** The declared type before `;base64,` is ignored: decodeImage reads the type from the bytes. */
const DATA_URI = /^data:[^;,]+;base64,(.*)$/s

type FalReply = { images?: { url?: unknown }[] }

const invalid = (detail: string) => new ProviderError('invalid_output', 'fal', detail)

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
      checkRequestSize(body, 'fal', 'Flux Kontext')

      const reply = await postJson({
        provider: 'fal',
        // Model ids are paths (`fal-ai/flux-pro/...`): encode each segment, keep the slashes.
        url: `https://fal.run/${model.split('/').map(encodeURIComponent).join('/')}`,
        headers: { authorization: `Key ${key}` },
        body,
        key, signal, fetchFn,
        // A generation lost to a network error may still be billed: never repeat it.
        idempotent: false,
      }) as FalReply | null

      const image = reply?.images?.[0]
      const url = image?.url
      if (typeof url !== 'string' || !url) throw invalid('no image in response')

      const data = DATA_URI.exec(url)
      if (data) return decodeImage(data[1], 'fal')

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

/** GETs the generated file. No auth header: the fal CDN link is public and must never see the key. */
async function download(url: string, key: string, signal: AbortSignal, fetchFn: typeof fetch): Promise<Uint8Array> {
  const fail = (detail: string) => new ProviderError('provider_error', 'fal', redact(detail, key).slice(0, MAX_DETAIL))
  try {
    // A redirect could lead to http or an internal host, bypassing the https-only check in generateImage.
    const res = await fetchFn(url, { method: 'GET', redirect: 'error', signal })
    if (!res.ok) throw fail(`image download failed: HTTP ${res.status}`)
    return await readCapped(res, MAX_IMAGE_BYTES, () => invalid(`image larger than ${MAX_IMAGE_BYTES} bytes`))
  } catch (err) {
    if (err instanceof ProviderError) throw err
    if (signal.aborted) throw abortError(signal, 'fal')
    throw fail(`image download failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
