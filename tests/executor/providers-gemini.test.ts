import { createGemini } from '../../packages/executor/src/providers/gemini.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'
import { ProviderError } from '../../packages/executor/src/providers/types.ts'
import { fakeFetch } from '../helpers/fake-fetch.ts'

const KEY = 'AIza-test-abcdef1234567890'
const MODEL = 'gemini-nano-banana-2.1'
const signal = () => AbortSignal.timeout(5000)
const bytes = (s: string) => new TextEncoder().encode(s)
const b64 = (s: string) => Buffer.from(s).toString('base64')
const reply = (parts: unknown[], extra: Record<string, unknown> = {}) =>
  ({ status: 200, json: { candidates: [{ content: { role: 'model', parts }, ...extra }] } })

/** Runs one generation against a scripted reply and returns the thrown error. */
async function generateError(json: unknown): Promise<ProviderError> {
  const fake = fakeFetch([{ status: 200, json }])
  const err = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  return err as ProviderError
}

it('sends prompt and reference images as inline_data', async () => {
  const fake = fakeFetch([reply([{ inlineData: { mimeType: 'image/png', data: b64('out') } }])])
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
  const ok = reply([{ inlineData: { mimeType: 'image/png', data: b64('out') } }])
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
  const fake = fakeFetch([reply([{ inlineData: { mimeType: 'image/png', data: b64('out') } }])])
  const img = { bytes: new Uint8Array(14_900_000), mimeType: 'image/png' } // about 19.9 MB in base64
  await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [img] }, signal())
  expect(fake.calls).toHaveLength(1)
})

it('decodes the returned image', async () => {
  const fake = fakeFetch([reply([{ text: 'Aqui está' }, { inlineData: { mimeType: 'image/png', data: b64('png-bytes') } }])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/png')
  expect(new TextDecoder().decode(out.bytes)).toBe('png-bytes')
})

it('accepts the snake_case inline_data part too', async () => {
  const fake = fakeFetch([reply([{ inline_data: { mime_type: 'image/webp', data: b64('webp-bytes') } }])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/webp')
  expect(new TextDecoder().decode(out.bytes)).toBe('webp-bytes')
})

it('skips thought images and returns the final one', async () => {
  const fake = fakeFetch([reply([
    { inlineData: { mimeType: 'image/png', data: b64('draft') }, thought: true },
    { inlineData: { mimeType: 'image/jpeg', data: b64('final') } },
  ])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/jpeg')
  expect(new TextDecoder().decode(out.bytes)).toBe('final')
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

it('image with an unsupported mimeType is invalid_output', async () => {
  const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/gif', data: b64('gif') } }] } }] })
  expect(err.code).toBe('invalid_output')
  expect(err.provider).toBe('gemini')
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
  const big = 'x'.repeat(20 * 1024 * 1024)
  const fake = fakeFetch([reply([{ inlineData: { mimeType: 'image/png', data: b64(big) } }])])
  const out = await createGemini(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.bytes.length).toBe(big.length)
})

it('empty image data is invalid_output', async () => {
  const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '' } }] } }] })
  expect(err.code).toBe('invalid_output')
})

it('createProviders registers gemini as an image provider', () => {
  const p = createProviders(fakeFetch([]).fn)
  expect(typeof p.image.gemini?.generateImage).toBe('function')
})
