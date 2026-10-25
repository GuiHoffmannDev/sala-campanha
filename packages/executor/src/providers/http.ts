import type { Provider } from '@sala/shared'
import { ProviderError } from './types.ts'

const RETRY_DELAY_MS = 2000
const MAX_DETAIL = 300

/** Replaces every occurrence of `key` with `[chave]`. An empty key leaves the text unchanged. */
export function redact(text: string, key: string): string {
  return key ? text.replaceAll(key, '[chave]') : text
}

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
 * 5xx or a network error. Every failure is a ProviderError with a redacted detail.
 */
export async function postJson(o: PostJsonOptions): Promise<unknown> {
  const fail = (code: 'provider_error' | 'invalid_output', detail: string) =>
    new ProviderError(code, o.provider, redact(detail, o.key).slice(0, MAX_DETAIL))
  const timeout = () => new ProviderError('timeout', o.provider, 'timeout')

  for (let attempt = 1; ; attempt++) {
    const last = attempt === 2
    let res: Response
    try {
      res = await o.fetchFn(o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify(o.body),
        signal: o.signal,
      })
    } catch (err) {
      if (o.signal.aborted) throw timeout()
      if (last) throw fail('provider_error', err instanceof Error ? err.message : String(err))
      if (!(await wait(RETRY_DELAY_MS, o.signal))) throw timeout()
      continue
    }

    let text: string
    try {
      text = await res.text()
    } catch (err) {
      if (o.signal.aborted) throw timeout()
      throw fail('provider_error', err instanceof Error ? err.message : String(err))
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
      if (!(await wait(RETRY_DELAY_MS, o.signal))) throw timeout()
      continue
    }
    throw fail('provider_error', errorMessage(text) ?? `HTTP ${res.status}`)
  }
}

/** `error.message` from an OpenAI, Anthropic or Gemini error body, if present. */
function errorMessage(text: string): string | undefined {
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } } | null)?.error?.message
    return typeof message === 'string' && message ? message : undefined
  } catch {
    return undefined
  }
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
