import { describe, expect, it } from 'vitest'
import { assertValidApiKey, bearerAuth, withBearer } from '../src/auth.js'

// Records what the wrapped fetch was called with, so tests can inspect the
// headers the wrapper produced without a network round-trip.
function spyFetch() {
  const calls: { input: unknown; init?: RequestInit }[] = []
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init })
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('bearerAuth', () => {
  it('formats the header value', () => {
    expect(bearerAuth('k1')).toBe('Bearer k1')
  })
})

describe('withBearer', () => {
  it('adds the bearer header to a (url, init) call', async () => {
    const { calls, impl } = spyFetch()
    await withBearer(impl, 'k1')('https://h/x', { method: 'GET' })
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(
      'Bearer k1',
    )
  })

  it('preserves caller headers alongside the bearer', async () => {
    const { calls, impl } = spyFetch()
    await withBearer(impl, 'k1')('https://h/x', {
      headers: { Range: 'bytes=10-', 'If-Range': 'etag1' },
    })
    const h = new Headers(calls[0].init?.headers)
    expect(h.get('range')).toBe('bytes=10-')
    expect(h.get('if-range')).toBe('etag1')
    expect(h.get('authorization')).toBe('Bearer k1')
  })

  it('preserves the request body and method (set-if-absent must not drop init)', async () => {
    const { calls, impl } = spyFetch()
    await withBearer(impl, 'k1')('https://h/x', {
      method: 'POST',
      body: JSON.stringify({ afterSeq: 42 }),
    })
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ afterSeq: 42 })
  })

  it('does not clobber an explicitly set Authorization header', async () => {
    const { calls, impl } = spyFetch()
    await withBearer(impl, 'k1')('https://h/x', {
      headers: { authorization: 'Bearer explicit' },
    })
    // Explicit wins, and the value is NOT comma-joined (no append()).
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(
      'Bearer explicit',
    )
  })

  it('adds the bearer header when called with a Request object', async () => {
    const { calls, impl } = spyFetch()
    await withBearer(impl, 'k1')(new Request('https://h/x', { method: 'GET' }))
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(
      'Bearer k1',
    )
  })

  it('keeps a Request-form call reconstructible with its body intact', async () => {
    // The wrapper hands the original Request through as `input` plus an init
    // carrying headers; the real fetch then does new Request(input, init).
    // Pin that this preserves method and body — otherwise authed POSTs would
    // silently lose their payload.
    const { calls, impl } = spyFetch()
    await withBearer(
      impl,
      'k1',
    )(new Request('https://h/x', { method: 'POST', body: 'hello' }))
    const rebuilt = new Request(calls[0].input as Request, calls[0].init)
    expect(rebuilt.method).toBe('POST')
    expect(rebuilt.headers.get('authorization')).toBe('Bearer k1')
    expect(await rebuilt.text()).toBe('hello')
  })

  it("does not clobber a Request object's own Authorization header", async () => {
    const { calls, impl } = spyFetch()
    await withBearer(
      impl,
      'k1',
    )(
      new Request('https://h/x', {
        headers: { authorization: 'Bearer explicit' },
      }),
    )
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(
      'Bearer explicit',
    )
  })
})

describe('assertValidApiKey', () => {
  it('accepts a normal-looking key', () => {
    expect(() => assertValidApiKey('sk_live_ABC123')).not.toThrow()
  })

  it('rejects the empty string', () => {
    expect(() => assertValidApiKey('')).toThrow()
  })

  it('rejects a whitespace-only string', () => {
    expect(() => assertValidApiKey('   ')).toThrow()
  })

  it('rejects a key containing an embedded newline', () => {
    expect(() => assertValidApiKey('sk_live_AAAA\nBBBB')).toThrow()
  })

  it('rejects a key containing an embedded carriage return', () => {
    expect(() => assertValidApiKey('sk_live_AAAA\rBBBB')).toThrow()
  })

  it('rejects a key containing an embedded NUL', () => {
    expect(() => assertValidApiKey('sk_live_AAAA\0BBBB')).toThrow()
  })

  it('never echoes any part of the key in the thrown message', () => {
    const secret = 'sk_live_AAAA\nBBBB_supersecretvalue'
    let message: string | undefined
    try {
      assertValidApiKey(secret)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toBeDefined()
    expect(message).not.toContain(secret)
    expect(message).not.toContain('AAAA')
    expect(message).not.toContain('supersecretvalue')
  })
})
