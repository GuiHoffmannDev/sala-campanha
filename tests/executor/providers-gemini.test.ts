import { createGemini } from '../../packages/executor/src/providers/gemini.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'
import { ProviderError } from '../../packages/executor/src/providers/types.ts'
import { fakeFetch } from '../helpers/fake-fetch.ts'
import { GIF, JPEG, PNG, WEBP, file } from '../helpers/images.ts'

const KEY = 'AIza-test-abcdef1234567890'
const MODEL = 'gemini-nano-banana-2.1'
const signal = () => AbortSignal.timeout(5000)

afterEach(() => { vi.useRealTimers() })
const bytes = (s: string) => new TextEncoder().encode(s)
const b64 = (s: string) => Buffer.from(s).toString('base64')
const encode = (b: Uint8Array) => Buffer.from(b).toString('base64')
const reply = (parts: unknown[], extra: Record<string, unknown> = {}) =>
  ({ status: 200, json: { candidates: [{ content: { role: 'model', parts }, ...extra }] } })
/** A reply carrying one image part with `bytes`, labeled `mimeType`. */
const imageReply = (bytes: Uint8Array, mimeType = 'image/png') => reply([{ inlineData: { mimeType, data: encode(bytes) } }])

/** Runs one generation against a scripted reply and returns the thrown error. */
async function generateError(json: unknown): Promise<ProviderError> {
  const fake = fakeFetch([{ status: 200, json }])
  const err = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  return err as ProviderError
}

it('sends prompt and reference images as inline_data', async () => {
  const fake = fakeFetch([imageReply(file(PNG))])
  await createGemini(fake.fn).generateImage(KEY, {
    model: MODEL,
    prompt: 'Banner de verão',
    images: [{ bytes: bytes('img-1'), mimeType: 'image/png' }, { bytes: bytes('img-2'), mimeType: 'image/jpeg' }],
  }, signal())
  expect(fake.calls[0]).toMatchObject({
    url: `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`,
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
  })
  expect(fake.calls[0]!.body).toEqual({
    contents: [{ parts: [
      { text: 'Banner de verão' },
      { inline_data: { mime_type: 'image/png', data: b64('img-1') } },
      { inline_data: { mime_type: 'image/jpeg', data: b64('img-2') } },
    ] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  })
})

it('sends the chosen effort as thinkingLevel only when there is one', async () => {
  const ok = imageReply(file(PNG))
  const fake = fakeFetch([ok, ok])
  const gemini = createGemini(fake.fn)
  await gemini.generateImage(KEY, { model: MODEL, prompt: 'P', images: [], effort: 'high' }, signal())
  await gemini.generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  const configs = fake.calls.map((c) => (c.body as { generationConfig: Record<string, unknown> }).generationConfig)
  // generateContent takes the ThinkingLevel enum name; the catalog keeps the lowercase effort.
  expect(configs[0]).toEqual({ responseModalities: ['TEXT', 'IMAGE'], thinkingConfig: { thinkingLevel: 'HIGH' } })
  expect(configs[1]).toEqual({ responseModalities: ['TEXT', 'IMAGE'] })
})

it('rejects reference images over the 20 MB request limit without calling Gemini', async () => {
  const fake = fakeFetch([])
  const big = { bytes: new Uint8Array(8 * 1024 * 1024), mimeType: 'image/png' } // 8 MiB, about 11.2 MB in base64
  const err = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [big, big] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.code).toBe('provider_error')
  expect(err.detail).toMatch(/^as imagens de referência somam 22,4 MB; o limite do Gemini é 20 MB por pedido/)
  expect(fake.calls).toHaveLength(0)
})

it('sends reference images just under the request limit', async () => {
  const fake = fakeFetch([imageReply(file(PNG))])
  const img = { bytes: new Uint8Array(14_900_000), mimeType: 'image/png' } // about 19.9 MB in base64
  await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [img] }, signal())
  expect(fake.calls).toHaveLength(1)
})

it('decodes the returned image', async () => {
  const fake = fakeFetch([reply([{ text: 'Aqui está' }, { inlineData: { mimeType: 'image/png', data: encode(file(PNG)) } }])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/png')
  expect(out.bytes).toEqual(file(PNG))
})

it('takes the image type from its bytes, not from the declared mimeType', async () => {
  for (const [sig, label, type] of [[JPEG, 'image/png', 'image/jpeg'], [PNG, 'image/webp', 'image/png'], [WEBP, 'image/jpeg', 'image/webp']] as const) {
    const fake = fakeFetch([imageReply(file([...sig]), label)])
    const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
    expect(out.mimeType).toBe(type)
  }
})

it('an image of exactly 25 MiB is accepted', async () => {
  const fake = fakeFetch([imageReply(file(PNG, 26_214_400))])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.bytes.length).toBe(26_214_400)
})

it('an image over 25 MiB is invalid_output', async () => {
  // 26_214_401 bytes: the base64 is not longer than a 25 MiB image's, the decoded file is.
  // 26_214_403 bytes: the base64 alone is too long, refused before decoding.
  for (const size of [26_214_401, 26_214_403]) {
    const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: encode(file(PNG, size)) } }] } }] })
    expect(err.code).toBe('invalid_output')
    expect(err.provider).toBe('gemini')
  }
})

it('accepts the snake_case inline_data part too', async () => {
  const fake = fakeFetch([reply([{ inline_data: { mime_type: 'image/webp', data: encode(file(WEBP)) } }])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/webp')
  expect(out.bytes).toEqual(file(WEBP))
})

it('skips thought images and returns the final one', async () => {
  const fake = fakeFetch([reply([
    { inlineData: { mimeType: 'image/png', data: encode(file(PNG)) }, thought: true },
    { inlineData: { mimeType: 'image/jpeg', data: encode(file(JPEG)) } },
  ])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/jpeg')
  expect(out.bytes).toEqual(file(JPEG))
})

it('no image part becomes provider_error with the model text', async () => {
  const err = await generateError({ candidates: [{ content: { parts: [{ text: 'Não posso gerar isso' }] }, finishReason: 'SAFETY' }] })
  expect(err.code).toBe('provider_error')
  expect(err.provider).toBe('gemini')
  expect(err.detail).toContain('Não posso gerar isso')
})

it('no image and no text reports finishReason or the prompt block reason', async () => {
  expect((await generateError({ candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] })).detail).toContain('IMAGE_SAFETY')
  expect((await generateError({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).detail).toContain('PROHIBITED_CONTENT')
  expect((await generateError({})).code).toBe('provider_error')
})

it('no-image detail without model text is readable Portuguese', async () => {
  expect((await generateError({ candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] })).detail)
    .toBe('imagem bloqueada pelo filtro de segurança (IMAGE_SAFETY)')
  expect((await generateError({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).detail)
    .toBe('conteúdo proibido pela política do Gemini (PROHIBITED_CONTENT)')
  // STOP without an image is not a safety block: say only that no image came back.
  expect((await generateError({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] })).detail)
    .toBe('o modelo não devolveu imagem (STOP)')
  expect((await generateError({})).detail).toBe('o modelo não devolveu imagem')
})

it('no-image detail is redacted and cut at 300 characters', async () => {
  const err = await generateError({ candidates: [{ content: { parts: [{ text: `chave ${KEY} ${'x'.repeat(400)}` }] } }] })
  expect(err.detail).not.toContain(KEY)
  expect(err.detail).toContain('[chave]')
  expect(err.detail.length).toBeLessThanOrEqual(300)
})

it('an image that is not PNG, JPEG or WebP is invalid_output, whatever its label says', async () => {
  for (const [bytes, mimeType] of [[file(GIF), 'image/gif'], [file(GIF), 'image/png'], [new TextEncoder().encode('<html>'), 'image/jpeg']] as const) {
    const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: encode(bytes) } }] } }] })
    expect(err.code).toBe('invalid_output')
    expect(err.provider).toBe('gemini')
  }
})

it('invalid base64 image data is invalid_output', async () => {
  // Buffer.from would silently drop the bad characters and return garbage bytes.
  for (const data of ['not base64!!', `${b64('png-bytes')}$$`, 'abc']) {
    const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] } }] })
    expect(err.code).toBe('invalid_output')
    expect(err.detail).toBe('invalid base64 image data')
  }
})

it('decodes a multi-megabyte image without overflowing the base64 check', async () => {
  const fake = fakeFetch([imageReply(file(PNG, 20 * 1024 * 1024))])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.bytes.length).toBe(20 * 1024 * 1024)
})

it('empty image data is invalid_output', async () => {
  const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '' } }] } }] })
  expect(err.code).toBe('invalid_output')
})

it('a network error is never retried: the generation may already be billed', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ error: new TypeError(`fetch failed ${KEY}`) }, imageReply(file(PNG))])
  const pending = createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, new AbortController().signal).catch((e) => e)
  await vi.advanceTimersByTimeAsync(2000)
  const err = await pending
  expect(fake.calls).toHaveLength(1)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err).toMatchObject({ code: 'provider_error', provider: 'gemini', detail: 'fetch failed [chave]' })
})

it('a connection dropped while reading the reply is never retried', async () => {
  vi.useFakeTimers()
  let calls = 0
  const fn = (async () => {
    calls++
    return new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated')) } }), { status: 200 })
  }) as typeof fetch
  const pending = createGemini(fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, new AbortController().signal).catch((e) => e)
  await vi.advanceTimersByTimeAsync(2000)
  expect(await pending).toMatchObject({ code: 'provider_error', provider: 'gemini' })
  expect(calls).toBe(1)
})

it('a 429 is still retried once', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ status: 429, json: { error: { message: 'slow down' } } }, imageReply(file(PNG))])
  const pending = createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(2000)
  expect((await pending).mimeType).toBe('image/png')
  expect(fake.calls).toHaveLength(2)
})

it('createProviders registers gemini as an image provider', () => {
  const p = createProviders(fakeFetch([]).fn)
  expect(typeof p.image.gemini?.generateImage).toBe('function')
})
