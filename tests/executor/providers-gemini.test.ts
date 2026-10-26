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

it('empty image data is invalid_output', async () => {
  const err = await generateError({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '' } }] } }] })
  expect(err.code).toBe('invalid_output')
})

it('createProviders registers gemini as the only image provider so far', () => {
  const p = createProviders(fakeFetch([]).fn)
  expect(Object.keys(p.image)).toEqual(['gemini'])
  expect(typeof p.image.gemini?.generateImage).toBe('function')
})
