import type { Provider } from '@sala/shared'
import { ProviderError } from './types.ts'

const RETRY_DELAY_MS = 2000
const MAX_DETAIL = 300
/** What fetch rejects in a header value after trimming: NUL, CR, LF, or a character above U+00FF. */
const INVALID_HEADER_VALUE = /[\0\r\n]|[^\0-\xff]/
const HTTP_WHITESPACE_ENDS = /^[\t\n\r ]+|[\t\n\r ]+$/g

/**
 * Replaces every occurrence of `key` with `[chave]`, and also the key without whitespace
 * at the ends, which is what fetch sends and what a provider echoes back. An empty key
 * leaves the text unchanged.
 */
export function redact(text: string, key: string): string {
  const sent = key.replace(HTTP_WHITESPACE_ENDS, '')
  if (!sent) return text
  return text.replaceAll(key, '[chave]').replaceAll(sent, '[chave]')
}

/**
 * Standard padded base64, as the APIs encode bytes; Buffer.from would silently skip anything else.
 * Plain character class plus a length check: a repeated group overflows the regex stack on multi-MB images.
 */
const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/
export const isBase64 = (s: string) => s.length % 4 === 0 && BASE64_CHARS.test(s)

export type PostJsonOptions = {
  provider: Provider
  url: string
  headers: Record<string, string>
  body: unknown
  key: string
  signal: AbortSignal
  fetchFn: typeof fetch
}

/**
 * POSTs JSON and returns the parsed JSON reply. Retries once, after 2 s, on 429,
 * 5xx or a network error. Every failure is a ProviderError with a redacted detail,
 * except an abort that is not a timeout: that rethrows `signal.reason` as is.
 */
export async function postJson(o: PostJsonOptions): Promise<unknown> {
  const fail = (code: 'provider_error' | 'invalid_output', detail: string) =>
    new ProviderError(code, o.provider, redact(detail, o.key).slice(0, MAX_DETAIL))
  // Only a deadline is a provider timeout. Any other abort (shutdown, lost claim) keeps its own reason.
  const aborted = () =>
    (o.signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError'
      ? new ProviderError('timeout', o.provider, 'timeout')
      : o.signal.reason

  // fetch throws a TypeError for these, which would look like a network error and be retried.
  // The detail names the header, never its value: the value usually carries the key.
  for (const [name, value] of Object.entries(o.headers)) {
    if (INVALID_HEADER_VALUE.test(value.replace(HTTP_WHITESPACE_ENDS, ''))) throw fail('provider_error', `invalid header value: ${name}`)
  }

  for (let attempt = 1; ; attempt++) {
    const last = attempt === 2
    let res: Response
    let text: string
    try {
      res = await o.fetchFn(o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify(o.body),
        signal: o.signal,
      })
      // Reading the body is inside the same try: a connection dropped mid-body is a network error too.
      text = await res.text()
    } catch (err) {
      if (o.signal.aborted) throw aborted()
      if (last) throw fail('provider_error', err instanceof Error ? err.message : String(err))
      if (!(await wait(RETRY_DELAY_MS, o.signal))) throw aborted()
      continue
    }

    if (res.ok) {
      try {
        return JSON.parse(text)
      } catch {
        throw fail('invalid_output', `invalid JSON from HTTP ${res.status}`)
      }
    }

    const retryable = res.status === 429 || res.status >= 500
    if (retryable && !last) {
      if (!(await wait(RETRY_DELAY_MS, o.signal))) throw aborted()
      continue
    }
    throw fail('provider_error', errorMessage(text) ?? `HTTP ${res.status}`)
  }
}

/**
 * `error.message` from an OpenAI, Anthropic or Gemini error body, or fal's `detail`: a string,
 * or on a 422 a list of `{ loc, msg }` validation errors, if present.
 */
function errorMessage(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown }; detail?: unknown } | null
    const message = body?.error?.message ?? body?.detail
    if (Array.isArray(message)) return validationMessage(message)
    return typeof message === 'string' && message ? message : undefined
  } catch {
    return undefined
  }
}

/** `loc: msg` per item, joined. Only `loc` and `msg`: `input` echoes what was sent (data URIs, prompts). */
function validationMessage(items: unknown[]): string | undefined {
  const parts = items.flatMap((item) => {
    const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown }
    if (typeof msg !== 'string' || !msg) return []
    // `body` is the root of every request field; the rest names the field.
    const path = Array.isArray(loc) ? loc.filter((p, i) => !(i === 0 && p === 'body')).join('.') : ''
    return [path ? `${path}: ${msg}` : msg]
  })
  return parts.length > 0 ? parts.join('; ') : undefined
}

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true) }, ms)
    const onAbort = () => { clearTimeout(timer); resolve(false) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
