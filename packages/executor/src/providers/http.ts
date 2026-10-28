import type { Provider } from '@sala/shared'
import { MAX_IMAGE_BYTES, ProviderError } from './types.ts'

const RETRY_DELAY_MS = 2000
/** Longest error detail kept: it reaches logs and the chat. */
export const MAX_DETAIL = 300
/** A reply that carries a 25 MiB image in base64, plus 1 MB for the JSON around it. */
// shortcut: no room for Gemini's up to two draft (`thought`) images next to a near-25 MiB final one;
// fine while requests use the default 1K size. Raise it before asking for 2K/4K, or if the live test sees thought images.
const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1_000_000
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

/**
 * What an aborted provider call throws. Only a deadline is a provider timeout;
 * any other abort (shutdown, lost claim) keeps its own reason.
 */
export function abortError(signal: AbortSignal, provider: Provider): unknown {
  return (signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError'
    ? new ProviderError('timeout', provider, 'timeout')
    : signal.reason
}

/**
 * Reads a response body of at most `cap` bytes. A larger `content-length` is refused
 * unread; otherwise the body is read in chunks and dropped as soon as it passes the cap,
 * so an oversized or endless body never fills memory.
 */
export async function readCapped(res: Response, cap: number, tooLarge: () => Error): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length')) > cap) {
    await res.body?.cancel()
    throw tooLarge()
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of res.body ?? []) {
    total += chunk.length
    if (total > cap) throw tooLarge() // leaving the loop cancels the stream
    chunks.push(chunk)
  }
  return new Uint8Array(Buffer.concat(chunks, total))
}

export type PostJsonOptions = {
  provider: Provider
  url: string
  headers: Record<string, string>
  body: unknown
  key: string
  signal: AbortSignal
  fetchFn: typeof fetch
  /** False for a call that may be billed even when its reply is lost: a network error is then never retried. */
  idempotent?: boolean
}

/**
 * POSTs JSON and returns the parsed JSON reply. Retries once, after 2 s, on 429 or 5xx,
 * and on a network error when the call is idempotent (the default). A reply over
 * MAX_RESPONSE_BYTES is invalid_output, never retried. Every failure is a ProviderError
 * with a redacted detail, except an abort that is not a timeout: that rethrows `signal.reason` as is.
 */
export async function postJson(o: PostJsonOptions): Promise<unknown> {
  const fail = (code: 'provider_error' | 'invalid_output', detail: string) =>
    new ProviderError(code, o.provider, redact(detail, o.key).slice(0, MAX_DETAIL))
  const aborted = () => abortError(o.signal, o.provider)
  const tooLarge = () => fail('invalid_output', `response larger than ${MAX_RESPONSE_BYTES} bytes`)

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
      text = new TextDecoder().decode(await readCapped(res, MAX_RESPONSE_BYTES, tooLarge))
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (o.signal.aborted) throw aborted()
      if (last || o.idempotent === false) throw fail('provider_error', err instanceof Error ? err.message : String(err))
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
