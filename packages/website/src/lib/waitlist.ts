// Waitlist signup through the Loops public form endpoint.
// The endpoint URL is public by design (it holds a form id, not a secret key).
// Docs: https://loops.so/docs/forms/custom-form

export type WaitlistResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-email' | 'not-configured' | 'rate-limited' | 'failed'; message: string }

// Same shape the browser's type="email" accepts in practice: something@domain.tld, no spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'

export async function joinWaitlist(
  endpoint: string,
  email: string,
  source: string,
  fetchFn: typeof fetch = fetch,
): Promise<WaitlistResult> {
  const address = email.trim()
  if (!isValidEmail(address)) {
    return { ok: false, reason: 'invalid-email', message: 'Please enter a valid email address.' }
  }
  if (!endpoint) {
    return { ok: false, reason: 'not-configured', message: 'The waitlist is not connected yet.' }
  }

  let response: Response
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: address, source }).toString(),
    })
  } catch {
    return { ok: false, reason: 'failed', message: GENERIC_ERROR }
  }

  if (response.status === 429) {
    return { ok: false, reason: 'rate-limited', message: 'Too many signups right now. Please try again in a moment.' }
  }

  let body: { success?: unknown; message?: unknown }
  try {
    body = await response.json()
  } catch {
    return { ok: false, reason: 'failed', message: GENERIC_ERROR }
  }

  if (response.ok && body.success === true) return { ok: true }
  const message = typeof body.message === 'string' && body.message ? body.message : GENERIC_ERROR
  return { ok: false, reason: 'failed', message }
}
