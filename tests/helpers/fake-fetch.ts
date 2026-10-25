/** A scripted reply: a JSON body, a raw text body, or a thrown network error. */
export type FakeReply = { status: number; json: unknown } | { status: number; text: string } | { error: Error }

export type FakeCall = { url: string; method: string; headers: Record<string, string>; body: unknown }

/**
 * A `fetch` stand-in that answers with `replies` in order and records every call.
 * Bodies are parsed back from JSON so tests can compare them as objects.
 */
export function fakeFetch(replies: FakeReply[]): { fn: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })
    const reply = replies[calls.length - 1]
    if (!reply) throw new Error(`fakeFetch: no reply scripted for call ${calls.length}`)
    if ('error' in reply) throw reply.error
    const body = 'json' in reply ? JSON.stringify(reply.json) : reply.text
    return new Response(body, { status: reply.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fn, calls }
}

/** A `fetch` that never answers and rejects with the signal's reason once it aborts. */
export function hangingFetch(): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      if (signal.aborted) reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })) as typeof fetch
}
