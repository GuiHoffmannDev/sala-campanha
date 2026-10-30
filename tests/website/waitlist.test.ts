import { describe, expect, it, vi } from 'vitest'
import { isValidEmail, joinWaitlist } from '../../packages/website/src/lib/waitlist.ts'

const ENDPOINT = 'https://app.loops.so/api/newsletter-form/test-form'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('isValidEmail', () => {
  it('accepts a normal address and trims spaces', () => {
    expect(isValidEmail('ana@brand.com')).toBe(true)
    expect(isValidEmail('  ana@brand.com  ')).toBe(true)
  })

  it('rejects empty, missing @ or missing domain dot', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('ana.brand.com')).toBe(false)
    expect(isValidEmail('ana@brand')).toBe(false)
    expect(isValidEmail('ana @brand.com')).toBe(false)
  })
})

describe('joinWaitlist', () => {
  it('posts the trimmed email and source as a url-encoded form to the endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }))

    const result = await joinWaitlist(ENDPOINT, ' ana+tink@brand.com ', 'home-hero', fetchFn)

    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(new URLSearchParams(init.body).get('email')).toBe('ana+tink@brand.com')
    expect(new URLSearchParams(init.body).get('source')).toBe('home-hero')
  })

  it('rejects an invalid email without calling the network', async () => {
    const fetchFn = vi.fn()

    const result = await joinWaitlist(ENDPOINT, 'not-an-email', 'home-hero', fetchFn)

    expect(result).toMatchObject({ ok: false, reason: 'invalid-email' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('reports a missing endpoint without calling the network', async () => {
    const fetchFn = vi.fn()

    const result = await joinWaitlist('', 'ana@brand.com', 'home-hero', fetchFn)

    expect(result).toMatchObject({ ok: false, reason: 'not-configured' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps HTTP 429 to a rate-limit message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 429 }))

    const result = await joinWaitlist(ENDPOINT, 'ana@brand.com', 'home-hero', fetchFn)

    expect(result).toMatchObject({ ok: false, reason: 'rate-limited' })
  })

  it('shows the message Loops sends when it refuses the signup', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { success: false, message: 'Email is on the blocklist.' }))

    const result = await joinWaitlist(ENDPOINT, 'ana@brand.com', 'home-hero', fetchFn)

    expect(result).toEqual({ ok: false, reason: 'failed', message: 'Email is on the blocklist.' })
  })

  it('treats a 200 with success=false as a failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { success: false }))

    const result = await joinWaitlist(ENDPOINT, 'ana@brand.com', 'home-hero', fetchFn)

    expect(result).toMatchObject({ ok: false, reason: 'failed' })
  })

  it('returns a generic failure on network errors or a non-JSON body', async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const html = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 502 }))

    expect(await joinWaitlist(ENDPOINT, 'ana@brand.com', 'home-hero', offline)).toMatchObject({
      ok: false,
      reason: 'failed',
    })
    expect(await joinWaitlist(ENDPOINT, 'ana@brand.com', 'home-hero', html)).toMatchObject({
      ok: false,
      reason: 'failed',
    })
  })
})
