import { describe, expect, it, vi } from 'vitest'
import {
  abortableDelay,
  backoffDelay,
  isAbortError,
  isRetryableError,
  isRetryableStatus,
  parseRetryAfter,
  resolveRetry,
} from '../../src/xrpc/retry.js'

describe('retry primitives', () => {
  it('resolveRetry applies Infinity default maxAttempts + delay defaults', () => {
    const r = resolveRetry()
    expect(r.maxAttempts).toBe(Infinity)
    expect(r.baseDelayMs).toBe(250)
    expect(r.maxDelayMs).toBe(30_000)
    const r2 = resolveRetry({ maxAttempts: 3, baseDelayMs: 10 })
    expect(r2.maxAttempts).toBe(3)
    expect(r2.baseDelayMs).toBe(10)
  })

  it('isRetryableStatus matches the lex-client transient set, not others', () => {
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(undefined)).toBe(false)
  })

  it('isAbortError detects AbortError', () => {
    const e = new Error('x')
    e.name = 'AbortError'
    expect(isAbortError(e)).toBe(true)
    expect(isAbortError(new Error('nope'))).toBe(false)
  })

  it('isRetryableError: transport + retryable-status true; abort + 404 false', () => {
    const abort = new Error('a')
    abort.name = 'AbortError'
    expect(isRetryableError(abort)).toBe(false)
    // a generic (transport-like) non-abort error is retryable
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true)
    // an error carrying a non-retryable status is NOT retryable
    const notFound = Object.assign(new Error('nf'), { status: 404 })
    expect(isRetryableError(notFound)).toBe(false)
    const throttled = Object.assign(new Error('t'), { status: 429 })
    expect(isRetryableError(throttled)).toBe(true)
  })

  it('backoffDelay grows exponentially (pre-jitter ceiling) and caps at maxDelayMs', () => {
    const r = resolveRetry({ baseDelayMs: 100, maxDelayMs: 1000 })
    // full jitter: result in [0, ceil]; assert the ceiling by sampling many draws
    const ceilOf = (attempt: number) => {
      let max = 0
      for (let i = 0; i < 200; i++)
        max = Math.max(max, backoffDelay(attempt, r))
      return max
    }
    expect(ceilOf(1)).toBeLessThanOrEqual(100)
    expect(ceilOf(2)).toBeLessThanOrEqual(200)
    expect(ceilOf(2)).toBeGreaterThan(100) // grew past attempt 1's ceiling
    // capped
    for (let i = 0; i < 50; i++)
      expect(backoffDelay(10, r)).toBeLessThanOrEqual(1000)
  })

  it('backoffDelay honors Retry-After (capped by maxDelayMs)', () => {
    const r = resolveRetry({ baseDelayMs: 100, maxDelayMs: 1000 })
    expect(backoffDelay(1, r, 500)).toBe(500)
    expect(backoffDelay(1, r, 5000)).toBe(1000) // capped
  })

  it('parseRetryAfter reads delta-seconds', () => {
    const h = new Headers({ 'retry-after': '2' })
    expect(parseRetryAfter(h)).toBe(2000)
    expect(parseRetryAfter(new Headers())).toBeUndefined()
    expect(parseRetryAfter(undefined)).toBeUndefined()
  })

  it('abortableDelay rejects on abort', async () => {
    const ac = new AbortController()
    const p = abortableDelay(10_000, ac.signal)
    ac.abort(new Error('stop'))
    await expect(p).rejects.toBeTruthy()
  })

  it('abortableDelay resolves after the delay', async () => {
    vi.useFakeTimers()
    const p = abortableDelay(50)
    vi.advanceTimersByTime(50)
    await expect(p).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})
