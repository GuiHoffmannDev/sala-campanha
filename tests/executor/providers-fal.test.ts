import { createFal } from '../../packages/executor/src/providers/fal.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'
import { ProviderError } from '../../packages/executor/src/providers/types.ts'
import { fakeFetch } from '../helpers/fake-fetch.ts'

const KEY = 'fal-test-key-abcdef1234567890'
const MODEL = 'fal-ai/flux-pro/kontext/max/multi'
const signal = () => AbortSignal.timeout(5000)
const bytes = (s: string) => new TextEncoder().encode(s)
const b64 = (s: string) => Buffer.from(s).toString('base64')
const dataUri = (mime: string, s: string) => `data:${mime};base64,${b64(s)}`
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
  const fake = fakeFetch([result(dataUri('image/png', 'out'))])
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
    image_urls: [dataUri('image/png', 'img-1'), dataUri('image/jpeg', 'img-2')],
    sync_mode: true,
    output_format: 'png',
  })
})

it('uses text-to-image without references', async () => {
  const fake = fakeFetch([result(dataUri('image/png', 'out'))])
  await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'Só texto', images: [] }, signal())
  expect(fake.calls[0]!.url).toBe('https://fal.run/fal-ai/flux-pro/kontext/max/text-to-image')
  expect(fake.calls[0]!.headers.authorization).toBe(`Key ${KEY}`)
  expect(fake.calls[0]!.body).toEqual({ prompt: 'Só texto', sync_mode: true, output_format: 'png' })
})

it('decodes a data URI result', async () => {
  const fake = fakeFetch([result(dataUri('image/png', 'png-bytes'))])
  const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(out.mimeType).toBe('image/png')
  expect(new TextDecoder().decode(out.bytes)).toBe('png-bytes')
})

it('downloads an https result without sending the key', async () => {
  const fake = fakeFetch([result('https://v3.fal.media/files/x/out.png'), { status: 200, text: 'downloaded-bytes' }])
  const out = await createFal(fake.fn).generateImage(KEY, { model: MODEL, prompt: 'P', images: [] }, signal())
  expect(fake.calls).toHaveLength(2)
  expect(fake.calls[1]).toMatchObject({ url: 'https://v3.fal.media/files/x/out.png', method: 'GET' })
  expect(fake.calls[1]!.headers).toEqual({})
  expect(JSON.stringify(fake.calls[1])).not.toContain(KEY)
  expect(out.mimeType).toBe('image/png')
  expect(new TextDecoder().decode(out.bytes)).toBe('downloaded-bytes')
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

it('a data URI with an unsupported type or invalid base64 is invalid_output', async () => {
  expect((await generateError([result(dataUri('image/gif', 'gif'))])).code).toBe('invalid_output')
  expect((await generateError([result('data:image/png;base64,not base64!!')])).code).toBe('invalid_output')
  expect((await generateError([result('data:image/png;base64,')])).code).toBe('invalid_output')
})

it('an https result with an unsupported content_type is invalid_output', async () => {
  const err = await generateError([result('https://v3.fal.media/files/x/out.gif', 'image/gif'), { status: 200, text: 'gif' }])
  expect(err.code).toBe('invalid_output')
})

it('reports the fal error detail, redacted', async () => {
  const err = await generateError([{ status: 401, json: { detail: `invalid key ${KEY}`, error_type: 'bad_request' } }])
  expect(err.code).toBe('provider_error')
  expect(err.detail).toContain('invalid key')
  expect(err.detail).not.toContain(KEY)
})

it('createProviders registers gemini and fal as image providers', () => {
  const p = createProviders(fakeFetch([]).fn)
  expect(Object.keys(p.image).sort()).toEqual(['fal', 'gemini'])
  expect(typeof p.image.fal?.generateImage).toBe('function')
})
