import { describe, expect, it } from 'vitest'
import { streamSegment } from '../../src/xrpc/download.js'
import { DownloadError } from '../../src/xrpc/errors.js'

function streamingFetch(bodyChunks: Uint8Array[], status = 200): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url)
    if (!u.includes('getSegment')) throw new Error(`unexpected ${u}`)
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of bodyChunks) c.enqueue(ch)
        c.close()
      },
    })
    return new Response(status === 200 ? body : 'nope', { status })
  }) as unknown as typeof fetch
}

async function collect(src: AsyncIterable<Uint8Array>) {
  const out: Uint8Array[] = []
  for await (const c of src) out.push(c)
  return out
}

describe('streamSegment', () => {
  it('yields response body chunks and builds the getSegment URL with name', async () => {
    let seenUrl = ''
    const fetchImpl = (async (url: string | URL, _init?: unknown) => {
      seenUrl = String(url)
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1, 2]))
          c.enqueue(new Uint8Array([3]))
          c.close()
        },
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch

    const chunks = await collect(
      streamSegment('https://h', 'seg_0.jss', fetchImpl),
    )
    expect(seenUrl).toContain('/xrpc/network.bsky.jetstream.getSegment')
    expect(seenUrl).toContain('name=seg_0.jss')
    expect(chunks.flatMap((c) => [...c])).toEqual([1, 2, 3])
  })

  it('throws on non-2xx', async () => {
    // 404 is non-retryable: streamSegment throws immediately (no retry loop hang).
    await expect(
      collect(streamSegment('https://h', 'seg_0.jss', streamingFetch([], 404))),
    ).rejects.toThrow()
  })

  it('throws DownloadError with status on non-2xx', async () => {
    // 404 non-retryable -> immediate DownloadError (503 would retry forever).
    const src = streamSegment('https://h', 'seg_0.jss', streamingFetch([], 404))
    await expect(
      (async () => {
        for await (const _ of src) void _
      })(),
    ).rejects.toBeInstanceOf(DownloadError)
  })

  it('drains (cancels) the error response body on non-2xx', async () => {
    // An unconsumed body keeps the undici socket checked out (a leak in Node).
    // Keep 503 (retryable) but cap attempts so the drain-then-throw is verified
    // without the default Infinity retry looping forever.
    let cancelled = false
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([110, 111])) // "no"
          c.close()
        },
        cancel() {
          cancelled = true
        },
      })
      return new Response(body, { status: 503 })
    }) as unknown as typeof fetch

    await expect(
      collect(
        streamSegment('https://h', 'seg_0.jss', fetchImpl, undefined, {
          maxAttempts: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(DownloadError)
    expect(cancelled).toBe(true)
  })

  it('resumes mid-stream via Range + If-Range on a transient break (206)', async () => {
    // Attempt 1: 200, ETag "abc", yields [1,2] then the body errors mid-stream.
    // Attempt 2: sees Range: bytes=2- + If-Range: "abc" -> 206 with [3,4].
    const seenHeaders: Array<Record<string, string>> = []
    let attempt = 0
    const fetchImpl = (async (
      _url: string | URL,
      init?: { headers?: Record<string, string> },
    ) => {
      attempt++
      seenHeaders.push({ ...(init?.headers ?? {}) })
      if (attempt === 1) {
        // Deliver [1,2] on the first read, THEN error mid-stream: enqueue+error
        // in the same synchronous start() drops the chunk (the reader rejects
        // before delivering it), so use pull() to sequence the two reads.
        let pulls = 0
        const body = new ReadableStream<Uint8Array>({
          pull(c) {
            pulls++
            if (pulls === 1) c.enqueue(new Uint8Array([1, 2]))
            else c.error(new Error('conn reset')) // mid-stream transport failure
          },
        })
        return new Response(body, { status: 200, headers: { etag: '"abc"' } })
      }
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([3, 4]))
          c.close()
        },
      })
      return new Response(body, {
        status: 206,
        headers: { etag: '"abc"', 'content-range': 'bytes 2-3/4' },
      })
    }) as unknown as typeof fetch

    const chunks = await collect(
      streamSegment('https://h', 'seg_0.jss', fetchImpl, undefined, {
        baseDelayMs: 1,
        maxDelayMs: 1,
      }),
    )
    expect(chunks.flatMap((c) => [...c])).toEqual([1, 2, 3, 4]) // no dup, no gap
    // resume request carried Range + If-Range with the captured ETag
    expect(seenHeaders[1]?.['Range'] ?? seenHeaders[1]?.['range']).toBe(
      'bytes=2-',
    )
    expect(seenHeaders[1]?.['If-Range'] ?? seenHeaders[1]?.['if-range']).toBe(
      '"abc"',
    )
  })

  it('throws (cannot splice) when resume returns 200 not 206', async () => {
    let attempt = 0
    const fetchImpl = (async () => {
      attempt++
      if (attempt === 1) {
        let pulls = 0
        const body = new ReadableStream<Uint8Array>({
          pull(c) {
            pulls++
            if (pulls === 1) c.enqueue(new Uint8Array([1, 2]))
            else c.error(new Error('reset'))
          },
        })
        return new Response(body, { status: 200, headers: { etag: '"abc"' } })
      }
      // ETag changed (compaction) -> server sends full 200, not 206.
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([9, 9, 9]))
          c.close()
        },
      })
      return new Response(body, { status: 200, headers: { etag: '"def"' } })
    }) as unknown as typeof fetch

    await expect(
      collect(
        streamSegment('https://h', 'seg_0.jss', fetchImpl, undefined, {
          baseDelayMs: 1,
          maxDelayMs: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(DownloadError)
  })

  it('retries a pre-body failure from scratch (no Range header)', async () => {
    let attempt = 0
    const seenHeaders: Array<Record<string, string>> = []
    const fetchImpl = (async (
      _url: string | URL,
      init?: { headers?: Record<string, string> },
    ) => {
      attempt++
      seenHeaders.push({ ...(init?.headers ?? {}) })
      if (attempt === 1) return new Response('busy', { status: 503 })
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([7]))
          c.close()
        },
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch

    const chunks = await collect(
      streamSegment('https://h', 'seg_0.jss', fetchImpl, undefined, {
        baseDelayMs: 1,
        maxDelayMs: 1,
      }),
    )
    expect(chunks.flatMap((c) => [...c])).toEqual([7])
    // the retry (attempt 2) had NO Range header — restarted from scratch
    expect(
      seenHeaders[1]?.['Range'] ?? seenHeaders[1]?.['range'],
    ).toBeUndefined()
  })
})
