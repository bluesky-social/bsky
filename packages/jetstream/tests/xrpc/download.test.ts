import { expect, test, vi } from 'vitest'
import { getBlock, getSegment } from '../../src/xrpc/download.js'
import { DownloadError } from '../../src/xrpc/errors.js'

function fakeFetch(body: Uint8Array, status = 200): typeof fetch {
  return (async (_url: string | URL) => {
    return new Response(status === 200 ? body : null, { status })
  }) as unknown as typeof fetch
}

test('getSegment returns raw bytes and builds the right URL', async () => {
  let seen = ''
  const f = (async (url: string | URL) => {
    seen = String(url)
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }) as unknown as typeof fetch
  const out = await getSegment('https://js.example', 'seg_00.jss', f)
  expect(Array.from(out)).toEqual([1, 2, 3])
  expect(seen).toContain('/xrpc/network.bsky.jetstream.getSegment')
  expect(seen).toContain('name=seg_00.jss')
})

test('getBlock passes segment + blockIndex params', async () => {
  let seen = ''
  const f = (async (url: string | URL) => {
    seen = String(url)
    return new Response(new Uint8Array([9]), { status: 200 })
  }) as unknown as typeof fetch
  await getBlock('https://js.example', 'seg_00.jss', 4, f)
  expect(seen).toContain('segment=seg_00.jss')
  expect(seen).toContain('blockIndex=4')
})

test('non-200 throws', async () => {
  await expect(
    getSegment('https://js.example', 'x', fakeFetch(new Uint8Array(), 404)),
  ).rejects.toThrow()
})

test('getBlock throws DownloadError (with cause) on HTTP failure', async () => {
  const fetchImpl = (async () =>
    new Response('not found', { status: 404 })) as unknown as typeof fetch
  await expect(
    getBlock('https://h', 'a.jss', 0, fetchImpl),
  ).rejects.toBeInstanceOf(DownloadError)
})

test('getBlock retries a 503 then succeeds; onRetry fires per attempt', async () => {
  let calls = 0
  const onRetry = vi.fn()
  const fetchImpl = (async () => {
    calls++
    if (calls < 3) return new Response('busy', { status: 503 })
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }) as unknown as typeof fetch

  const out = await getBlock('https://h', 'a.jss', 0, fetchImpl, undefined, {
    baseDelayMs: 1,
    maxDelayMs: 2,
    onRetry,
  })
  expect(out.length).toBeGreaterThan(0)
  expect(calls).toBe(3)
  expect(onRetry).toHaveBeenCalledTimes(2)
  const info = onRetry.mock.calls[0][1]
  expect(info.target).toEqual({ kind: 'block', name: 'a.jss', blockIndex: 0 })
  expect(info.attempt).toBe(1)
})

test('getBlock throws DownloadError immediately on 404 (no retry)', async () => {
  const onRetry = vi.fn()
  const fetchImpl = (async () =>
    new Response('missing', { status: 404 })) as unknown as typeof fetch
  await expect(
    getBlock('https://h', 'a.jss', 0, fetchImpl, undefined, { onRetry }),
  ).rejects.toBeInstanceOf(DownloadError)
  expect(onRetry).not.toHaveBeenCalled()
})

test('getBlock stops after maxAttempts and throws DownloadError', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    return new Response('x', { status: 503 })
  }) as unknown as typeof fetch
  await expect(
    getBlock('https://h', 'a.jss', 0, fetchImpl, undefined, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
    }),
  ).rejects.toBeInstanceOf(DownloadError)
  expect(calls).toBe(3)
})
