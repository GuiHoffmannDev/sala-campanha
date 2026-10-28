import { createFal } from '../../packages/executor/src/providers/fal.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'
import { ProviderError } from '../../packages/executor/src/providers/types.ts'
import { fakeFetch } from '../helpers/fake-fetch.ts'
import { GIF, JPEG, PNG, WEBP, file } from '../helpers/images.ts'

const KEY = 'fal-test-key-abcdef1234567890'
const MODEL = 'fal-ai/flux-pro/kontext/max/multi'
const signal = () => AbortSignal.timeout(5000)
const bytes = (s: string) => new TextEncoder().encode(s)
const dataUri = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`
const pngUri = dataUri('image/png', file(PNG))

afterEach(() => { vi.useRealTimers() })
const result = (url: string, content_type = 'image/png') => ({ status: 200, json: { images: [{ url, content_type }], prompt: 'P' } })

/** Runs one text-to-image generation against scripted replies and returns the thrown error. */
async function generateError(replies: Parameters<typeof fakeFetch>[0]): Promise<ProviderError> {
  const fake = fakeFetch(replies)
  const err = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.provider).toBe('fal')
  return err as ProviderError
}

it('uses the multi endpoint with data URIs when there are references', async () => {
  const fake = fakeFetch([result(pngUri)])
  await createFal(fake.fn).generateImage(KEY, {
    model: MODEL,
    prompt: 'Banner de verão',
    images: [{ bytes: bytes('img-1'), mimeType: 'image/png' }, { bytes: bytes('img-2'), mimeType: 'image/jpeg' }],
  }, signal())
  expect(fake.calls).toHaveLength(1)
  expect(fake.calls[0]).toMatchObject({
    url: 'https://fal.run/fal-ai/flux-pro/kontext/max/multi',
    method: 'POST',
    headers: { authorization: `Key ${KEY}`, 'content-type': 'application/json' },
  })
  expect(fake.calls[0]!.body).toEqual({
    prompt: 'Banner de verão',
    image_urls: [dataUri('image/png', bytes('img-1')), dataUri('image/jpeg', bytes('img-2'))],
    sync_mode: true,
    output_format: 'png',
  })
})

it('rejects reference images over the 20 MB request limit without calling fal', async () => {
  const fake = fakeFetch([])
  const big = { bytes: new Uint8Array(8 * 1024 * 1024), mimeType: 'image/png' as const } // 8 MiB, about 11.2 MB in base64
  const err = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [big, big] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.code).toBe('provider_error')
  expect(err.detail).toMatch(/^as imagens de referência somam 22,4 MB; o limite do Flux Kontext é 20 MB por pedido/)
  expect(fake.calls).toHaveLength(0)
})

it('sends reference images just under the request limit', async () => {
  const fake = fakeFetch([result(pngUri)])
  const img = { bytes: new Uint8Array(14_900_000), mimeType: 'image/png' as const } // about 19.9 MB in base64
  await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [img] }, signal())
  expect(fake.calls).toHaveLength(1)
})

it('uses text-to-image without references', async () => {
  const fake = fakeFetch([result(pngUri)])
  await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'Só texto', images: [] }, signal())
  expect(fake.calls[0]!.url).toBe('https://fal.run/fal-ai/flux-pro/kontext/max/text-to-image')
  expect(fake.calls[0]!.headers.authorization).toBe(`Key ${KEY}`)
  expect(fake.calls[0]!.body).toEqual({ prompt: 'Só texto', sync_mode: true, output_format: 'png' })
})

it('decodes a data URI result', async () => {
  const fake = fakeFetch([result(pngUri)])
  const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/png')
  expect(out.bytes).toEqual(file(PNG))
})

it('a data URI result takes its type from its bytes, not from its prefix', async () => {
  for (const [sig, label, type] of [[JPEG, 'image/png', 'image/jpeg'], [PNG, 'image/webp', 'image/png'], [WEBP, 'image/jpeg', 'image/webp']] as const) {
    const fake = fakeFetch([result(dataUri(label, file([...sig])))])
    const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
    expect(out.mimeType).toBe(type)
  }
})

it('a data URI result of exactly 25 MiB is accepted', async () => {
  const fake = fakeFetch([result(dataUri('image/png', file(PNG, 26_214_400)))])
  const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.bytes.length).toBe(26_214_400)
})

it('a data URI result over 25 MiB is invalid_output', async () => {
  // 26_214_401 bytes: the base64 is not longer than a 25 MiB image's, the decoded file is.
  // 26_214_403 bytes: the base64 alone is too long, refused before decoding.
  for (const size of [26_214_401, 26_214_403]) {
    expect((await generateError([result(dataUri('image/png', file(PNG, size)))])).code).toBe('invalid_output')
  }
})

it('downloads an https result without sending the key', async () => {
  const fake = fakeFetch([result('https://v3.fal.media/files/x/out.png'), { status: 200, bytes: file(PNG) }])
  const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(fake.calls).toHaveLength(2)
  expect(fake.calls[1]).toMatchObject({ url: 'https://v3.fal.media/files/x/out.png', method: 'GET' })
  expect(fake.calls[1]!.headers).toEqual({})
  expect(JSON.stringify(fake.calls[1])).not.toContain(KEY)
  expect(out.mimeType).toBe('image/png')
  expect(out.bytes).toEqual(file(PNG))
})

it('a redirected https download is refused, never followed', async () => {
  const urls: string[] = []
  // Mimics real fetch: a 302 is followed unless the caller asks for redirect 'error', which rejects.
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input))
    if (urls.length === 1) return Response.json({ images: [{ url: 'https://v3.fal.media/files/x/out.png', content_type: 'image/png' }] })
    if (init?.redirect !== 'error') {
      urls.push('http://169.254.169.254/latest/meta-data')
      return new Response('metadata', { status: 200 })
    }
    throw new TypeError('fetch failed: unexpected redirect')
  }) as typeof fetch
  const err = await createFal(fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.code).toBe('provider_error')
  expect(urls).toEqual(['https://fal.run/fal-ai/flux-pro/kontext/max/text-to-image', 'https://v3.fal.media/files/x/out.png'])
})

/** A fetch whose first reply is an https result and whose second is the download response `res`. */
function downloadFetch(res: Response): typeof fetch {
  let n = 0
  return (async () => (++n === 1
    ? Response.json({ images: [{ url: 'https://v3.fal.media/files/x/out.png', content_type: 'image/png' }] })
    : res)) as typeof fetch
}

it('a download whose content-length is over 25 MB is refused without reading the body', async () => {
  let pulled = false
  const body = new ReadableStream<Uint8Array>({ pull(c) { pulled = true; c.enqueue(new Uint8Array(10)); c.close() } }, { highWaterMark: 0 })
  const res = new Response(body, { headers: { 'content-length': String(26_214_401) } })
  const err = await createFal(downloadFetch(res)).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.code).toBe('invalid_output')
  expect(pulled).toBe(false)
})

it('a download that streams past 25 MB is cut off and refused', async () => {
  let sent = 0
  const chunk = new Uint8Array(1024 * 1024)
  // No content-length and an endless body: the reader must stop on its own.
  const body = new ReadableStream<Uint8Array>({ pull(c) { sent += chunk.length; c.enqueue(chunk) } }, { highWaterMark: 0 })
  const err = await createFal(downloadFetch(new Response(body))).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.code).toBe('invalid_output')
  expect(sent).toBeLessThanOrEqual(27 * 1024 * 1024)
})

it('a download of exactly 25 MB is accepted', async () => {
  const res = new Response(file(PNG, 26_214_400))
  const out = await createFal(downloadFetch(res)).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.bytes.length).toBe(26_214_400)
})

it('a failed https download is provider_error', async () => {
  const err = await generateError([result('https://v3.fal.media/files/x/out.png'), { status: 404, text: 'not found' }])
  expect(err.code).toBe('provider_error')
  expect(err.detail).toContain('404')
})

it('no image in the result is invalid_output', async () => {
  expect((await generateError([{ status: 200, json: { images: [] } }])).code).toBe('invalid_output')
  expect((await generateError([{ status: 200, json: {} }])).code).toBe('invalid_output')
  expect((await generateError([{ status: 200, json: { images: [{ content_type: 'image/png' }] } }])).code).toBe('invalid_output')
})

it('a result url that is neither https nor a data URI is invalid_output and is never fetched', async () => {
  for (const url of ['http://v3.fal.media/out.png', 'file:///etc/passwd', 'ftp://x/y.png']) {
    const fake = fakeFetch([result(url)])
    const err = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.code).toBe('invalid_output')
    expect(fake.calls).toHaveLength(1)
  }
})

it('a data URI that is not PNG, JPEG or WebP, or not valid base64, is invalid_output', async () => {
  expect((await generateError([result(dataUri('image/gif', file(GIF)))])).code).toBe('invalid_output')
  // The prefix says png, the bytes are a GIF: the bytes decide.
  expect((await generateError([result(dataUri('image/png', file(GIF)))])).code).toBe('invalid_output')
  expect((await generateError([result('data:image/png;base64,not base64!!')])).code).toBe('invalid_output')
  expect((await generateError([result('data:image/png;base64,')])).code).toBe('invalid_output')
})

it('a downloaded file takes its type from its bytes, not from content_type', async () => {
  for (const [sig, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']] as const) {
    // content_type says gif: ignored, the signature decides.
    const fake = fakeFetch([result('https://v3.fal.media/files/x/out', 'image/gif'), { status: 200, bytes: file([...sig]) }])
    const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
    expect(out.mimeType).toBe(type)
  }
})

it('a downloaded file that is not PNG, JPEG or WebP is invalid_output', async () => {
  for (const body of [bytes('GIF89a-not-allowed'), bytes('<html>error page</html>'), new Uint8Array([0x89, 0x50]), bytes('RIFF\0\0\0\0WAVE')]) {
    const err = await generateError([result('https://v3.fal.media/files/x/out.png'), { status: 200, bytes: body }])
    expect(err.code).toBe('invalid_output')
  }
})

it('reports the fal error detail, redacted', async () => {
  const err = await generateError([{ status: 401, json: { detail: `invalid key ${KEY}`, error_type: 'bad_request' } }])
  expect(err.code).toBe('provider_error')
  expect(err.detail).toContain('invalid key')
  expect(err.detail).not.toContain(KEY)
})

it('reports each fal validation error from a detail list, without echoing the input', async () => {
  const err = await generateError([{ status: 422, json: { detail: [
    { loc: ['body', 'image_urls', 0], msg: 'File too large', type: 'file_too_large', input: `data:image/png;base64,${KEY}` },
    { loc: ['body', 'prompt'], msg: `bad prompt ${KEY}`, type: 'value_error' },
  ] } }])
  expect(err.code).toBe('provider_error')
  expect(err.detail).toBe('image_urls.0: File too large; prompt: bad prompt [chave]')
})

it('a detail list with no usable msg falls back to the HTTP status', async () => {
  const err = await generateError([{ status: 422, json: { detail: [{ type: 'x' }, 'text'] } }])
  expect(err.detail).toBe('HTTP 422')
})

it('a network error is never retried: the generation may already be billed', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ error: new TypeError(`fetch failed ${KEY}`) }, result(pngUri)])
  const pending = createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, new AbortController().signal).catch((e) => e)
  await vi.advanceTimersByTimeAsync(2000)
  const err = await pending
  expect(fake.calls).toHaveLength(1)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err).toMatchObject({ code: 'provider_error', provider: 'fal', detail: 'fetch failed [chave]' })
})

it('a 429 is still retried once', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ status: 429, json: { detail: 'slow down' } }, result(pngUri)])
  const pending = createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(2000)
  expect((await pending).mimeType).toBe('image/png')
  expect(fake.calls).toHaveLength(2)
})

it('createProviders registers gemini and fal as image providers', () => {
  const p = createProviders(fakeFetch([]).fn)
  expect(Object.keys(p.image).sort()).toEqual(['fal', 'gemini'])
  expect(typeof p.image.fal?.generateImage).toBe('function')
})
