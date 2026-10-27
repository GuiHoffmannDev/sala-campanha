import { createAnthropic } from '../../packages/executor/src/providers/anthropic.ts'
import { postJson, redact } from '../../packages/executor/src/providers/http.ts'
import { createProviders } from '../../packages/executor/src/providers/index.ts'
import { createOpenAI } from '../../packages/executor/src/providers/openai.ts'
import { ProviderError } from '../../packages/executor/src/providers/types.ts'
import { fakeFetch, hangingFetch } from '../helpers/fake-fetch.ts'

const KEY = 'sk-live-abcdef1234567890'
const REQ = { model: 'claude-sonnet-5-5', system: 'S', prompt: 'P', maxOutputTokens: 2000 }
const signal = () => AbortSignal.timeout(5000)

/** Calls postJson against a scripted fetch and returns the thrown error. */
async function postError(fn: typeof fetch, key = KEY): Promise<ProviderError> {
  const err = await postJson({ provider: 'openai', url: 'https://x.test', headers: {}, body: {}, key, signal: signal(), fetchFn: fn }).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  return err as ProviderError
}

afterEach(() => { vi.useRealTimers() })

it('anthropic sends the request shape and joins text blocks', async () => {
  const fake = fakeFetch([{ status: 200, json: { content: [{ type: 'text', text: '{"caption":' }, { type: 'thinking', thinking: 'x' }, { type: 'text', text: '"Oi"}' }] } }])
  const out = await createAnthropic(fake.fn).generateText('sk-ant-test-0000000000', REQ, signal())
  expect(out).toBe('{"caption":"Oi"}')
  expect(fake.calls[0]).toMatchObject({
    url: 'https://api.anthropic.com/v1/messages', method: 'POST',
    headers: { 'x-api-key': 'sk-ant-test-0000000000', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  })
  expect(fake.calls[0]!.body).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 2000, system: 'S', messages: [{ role: 'user', content: 'P' }] })
})

it('openai sends the request shape and reads output_text', async () => {
  const fake = fakeFetch([{ status: 200, json: { output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"caption":' }, { type: 'refusal', refusal: 'no' }, { type: 'output_text', text: '"Oi"}' }] },
  ] } }])
  const out = await createOpenAI(fake.fn).generateText('sk-proj-test', { ...REQ, model: 'gpt-6-astra' }, signal())
  expect(out).toBe('{"caption":"Oi"}')
  expect(fake.calls[0]).toMatchObject({
    url: 'https://api.openai.com/v1/responses', method: 'POST',
    headers: { Authorization: 'Bearer sk-proj-test', 'content-type': 'application/json' },
  })
  expect(fake.calls[0]!.body).toEqual({ model: 'gpt-6-astra', instructions: 'S', input: 'P', max_output_tokens: 2000 })
})

it('sends the chosen effort only when there is one', async () => {
  const ok = { status: 200, json: { content: [{ type: 'text', text: 'x' }], output: [{ type: 'message', content: [{ type: 'output_text', text: 'x' }] }] } }
  const anthropic = fakeFetch([ok, ok])
  await createAnthropic(anthropic.fn).generateText(KEY, { ...REQ, effort: 'low' }, signal())
  await createAnthropic(anthropic.fn).generateText(KEY, REQ, signal())
  expect(anthropic.calls.map((c) => (c.body as Record<string, unknown>).output_config)).toEqual([{ effort: 'low' }, undefined])
  expect(anthropic.calls[1]!.body).not.toHaveProperty('output_config')

  const openai = fakeFetch([ok, ok])
  await createOpenAI(openai.fn).generateText(KEY, { ...REQ, model: 'gpt-6-astra', effort: 'low' }, signal())
  await createOpenAI(openai.fn).generateText(KEY, { ...REQ, model: 'gpt-6-astra' }, signal())
  expect(openai.calls.map((c) => (c.body as Record<string, unknown>).reasoning)).toEqual([{ effort: 'low' }, undefined])
  expect(openai.calls[1]!.body).not.toHaveProperty('reasoning')
})

it('empty text output is invalid_output', async () => {
  const anthropic = await createAnthropic(fakeFetch([{ status: 200, json: { content: [{ type: 'text', text: '' }] } }]).fn)
    .generateText(KEY, REQ, signal()).catch((e) => e)
  expect(anthropic).toMatchObject({ code: 'invalid_output', provider: 'anthropic' })
  const openai = await createOpenAI(fakeFetch([{ status: 200, json: { output: [] } }]).fn)
    .generateText(KEY, REQ, signal()).catch((e) => e)
  expect(openai).toMatchObject({ code: 'invalid_output', provider: 'openai' })
  expect(openai).toBeInstanceOf(ProviderError)
})

it('anthropic output cut by max_tokens is invalid_output', async () => {
  const fake = fakeFetch([{ status: 200, json: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"caption":"O' }] } }])
  const err = await createAnthropic(fake.fn).generateText(KEY, REQ, signal()).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err).toMatchObject({ code: 'invalid_output', provider: 'anthropic', detail: 'output truncated (max_tokens)' })
})

it('anthropic refusal is invalid_output, even with partial text', async () => {
  const fake = fakeFetch([
    { status: 200, json: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [{ type: 'text', text: '{"caption":"Comp' }] } },
    { status: 200, json: { stop_reason: 'refusal', stop_details: null, content: [] } },
    { status: 200, json: { stop_reason: 'refusal', stop_details: { category: `odd ${KEY}` }, content: [{ type: 'text', text: 'I cannot help with that.' }] } },
  ])
  const anthropic = createAnthropic(fake.fn)
  const errs = await Promise.all([1, 2, 3].map(() => anthropic.generateText(KEY, REQ, signal()).catch((e) => e)))
  expect(errs.every((e) => e instanceof ProviderError)).toBe(true)
  expect(errs.map((e) => [e.code, e.provider, e.detail])).toEqual([
    ['invalid_output', 'anthropic', 'refused (general_harms)'],
    ['invalid_output', 'anthropic', 'refused (unknown)'],
    ['invalid_output', 'anthropic', 'refused (odd [chave])'],
  ])
})

it('openai incomplete response is invalid_output, with the reason redacted', async () => {
  const output = [{ type: 'message', content: [{ type: 'output_text', text: '{"caption":"O' }] }]
  const fake = fakeFetch([
    { status: 200, json: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output } },
    { status: 200, json: { status: 'incomplete', incomplete_details: { reason: `odd ${KEY}` }, output } },
    { status: 200, json: { status: 'incomplete', output } },
  ])
  const openai = createOpenAI(fake.fn)
  const errs = await Promise.all([1, 2, 3].map(() => openai.generateText(KEY, REQ, signal()).catch((e) => e)))
  expect(errs.map((e) => [e.code, e.detail])).toEqual([
    ['invalid_output', 'output incomplete (max_output_tokens)'],
    ['invalid_output', 'output incomplete (odd [chave])'],
    ['invalid_output', 'output incomplete (unknown)'],
  ])
})

it('retries once on 429 then succeeds', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ status: 429, json: { error: { message: 'slow down' } } }, { status: 200, json: { content: [{ type: 'text', text: 'ok' }] } }])
  const out = createAnthropic(fake.fn).generateText(KEY, REQ, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(1999)
  expect(fake.calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await out).toBe('ok')
  expect(fake.calls).toHaveLength(2)
})

it('retries once on 5xx and network errors, then gives up', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ error: new TypeError('fetch failed') }, { status: 503, text: 'unavailable' }])
  const pending = postJson({ provider: 'gemini', url: 'https://x.test', headers: {}, body: {}, key: KEY, signal: new AbortController().signal, fetchFn: fake.fn }).catch((e) => e)
  await vi.advanceTimersByTimeAsync(2000)
  const err = await pending
  expect(fake.calls).toHaveLength(2)
  expect(err).toMatchObject({ code: 'provider_error', provider: 'gemini', detail: 'HTTP 503' })
})

it('retries once when the connection drops while reading the body', async () => {
  vi.useFakeTimers()
  const broken = new ReadableStream({ start(c) { c.error(new TypeError('terminated')) } })
  const fake = fakeFetch([{ status: 200, json: { content: [{ type: 'text', text: 'ok' }] } }])
  let calls = 0
  const fn = (async (input: string | URL | Request, init?: RequestInit) =>
    ++calls === 1 ? new Response(broken, { status: 200 }) : fake.fn(input, init)) as typeof fetch
  const out = createAnthropic(fn).generateText(KEY, REQ, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(2000)
  expect(await out).toBe('ok')
  expect(calls).toBe(2)
})

it('a key fetch would reject as a header fails at once, without a call', async () => {
  for (const bad of ['sk-a\nb', 'sk-a\rb', 'sk-a\0b', 'sk-açãoΩ']) {
    const fake = fakeFetch([])
    const err = await createOpenAI(fake.fn).generateText(bad, REQ, signal()).catch((e) => e)
    expect(err).toMatchObject({ code: 'provider_error', provider: 'openai', detail: 'invalid header value: Authorization' })
    expect(err.message).not.toContain(bad)
    expect(fake.calls).toHaveLength(0)
  }
  // fetch trims whitespace at the ends of a header value, so a trailing newline still goes out.
  const fake = fakeFetch([{ status: 200, json: { content: [{ type: 'text', text: 'ok' }] } }])
  expect(await createAnthropic(fake.fn).generateText('sk-ok\n', REQ, signal())).toBe('ok')
})

it('does not retry on 401', async () => {
  const fake = fakeFetch([{ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }])
  const err = await postError(fake.fn)
  expect(fake.calls).toHaveLength(1)
  expect(err).toMatchObject({ code: 'provider_error', provider: 'openai', detail: 'invalid x-api-key' })
})

it('redacts the key from provider error details', async () => {
  const fake = fakeFetch([{ status: 401, json: { error: { message: `Incorrect API key provided: ${KEY}. Again: ${KEY}` } } }])
  const err = await postError(fake.fn)
  expect(err.detail).not.toContain(KEY)
  expect(err.message).not.toContain(KEY)
  expect(err.detail).toBe('Incorrect API key provided: [chave]. Again: [chave]')
})

it('redacts network error text and cuts details at 300 characters', async () => {
  vi.useFakeTimers()
  const fake = fakeFetch([{ error: new Error(`boom ${KEY}`) }, { error: new Error(`boom ${KEY}`) }])
  const pending = postError(fake.fn)
  await vi.advanceTimersByTimeAsync(2000)
  expect((await pending).detail).toBe('boom [chave]')
  vi.useRealTimers()
  const long = await postError(fakeFetch([{ status: 400, json: { error: { message: 'x'.repeat(500) } } }]).fn)
  expect(long.detail).toHaveLength(300)
})

it('non-JSON success body is invalid_output', async () => {
  const err = await postError(fakeFetch([{ status: 200, text: '<html>oops</html>' }]).fn)
  expect(err.code).toBe('invalid_output')
})

it('timeout becomes ProviderError timeout', async () => {
  const err = await createOpenAI(hangingFetch()).generateText(KEY, REQ, AbortSignal.timeout(20)).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err).toMatchObject({ code: 'timeout', provider: 'openai' })
})

it('a timeout during the retry wait stops without a second call', async () => {
  const fake = fakeFetch([{ status: 500, text: '' }])
  const err = await postJson({ provider: 'fal', url: 'https://x.test', headers: {}, body: {}, key: KEY, signal: AbortSignal.timeout(50), fetchFn: fake.fn }).catch((e) => e)
  expect(err).toMatchObject({ code: 'timeout', provider: 'fal' })
  expect(fake.calls).toHaveLength(1)
})

it('an abort that is not a timeout rethrows the signal reason', async () => {
  const during = new AbortController()
  const pending = createOpenAI(hangingFetch()).generateText(KEY, REQ, during.signal).catch((e) => e)
  during.abort()
  const err = await pending
  expect(err).not.toBeInstanceOf(ProviderError)
  expect(err).toMatchObject({ name: 'AbortError' })

  vi.useFakeTimers()
  const inWait = new AbortController()
  const fake = fakeFetch([{ status: 503, text: '' }])
  const waiting = postJson({ provider: 'fal', url: 'https://x.test', headers: {}, body: {}, key: KEY, signal: inWait.signal, fetchFn: fake.fn }).catch((e) => e)
  await vi.advanceTimersByTimeAsync(500)
  const shutdown = new Error('shutdown')
  inWait.abort(shutdown)
  expect(await waiting).toBe(shutdown)
  expect(fake.calls).toHaveLength(1)
})

it('redact replaces every occurrence and leaves text alone for an empty key', () => {
  expect(redact(`a ${KEY} b ${KEY}`, KEY)).toBe('a [chave] b [chave]')
  expect(redact('nothing here', '')).toBe('nothing here')
})

it('redact also replaces the key as fetch sends it, without whitespace at the ends', () => {
  expect(redact(`Incorrect API key provided: ${KEY}.`, `\t ${KEY}\n`)).toBe('Incorrect API key provided: [chave].')
  expect(redact(`raw " ${KEY}\n"`, ` ${KEY}\n`)).toBe('raw "[chave]"')
  expect(redact('a \n b', ' \n ')).toBe('a \n b')
})

it('createProviders registers the text providers', () => {
  const p = createProviders(fakeFetch([]).fn)
  expect(Object.keys(p.text).sort()).toEqual(['anthropic', 'openai'])
})
