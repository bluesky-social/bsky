import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'
import {
  type LiveTransport,
  type LiveTransportOpts,
} from '../../src/live/transport.js'

const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

const planResponse = (mode: 'blocks' | 'segment') =>
  new Response(
    JSON.stringify({
      plannedThroughSeq: 3,
      sealedTipSeq: 3,
      segments: [
        {
          name: 'a.jss',
          index: 0,
          checksum: 'x'.repeat(16),
          minSeq: 1,
          maxSeq: 3,
          mode,
          ...(mode === 'blocks' ? { blocks: [{ first: 0, last: 0 }] } : {}),
        },
      ],
      stats: {
        segmentsExamined: 1,
        segmentsMatched: 1,
        blocksMatched: 1,
        entries: 1,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

// Captures the authorization header (and body) per endpoint. Headers are read
// through `new Headers(...)` because withBearer normalizes init.headers to a
// Headers instance, unlike the plain records passed when unauthed.
function recordingFetch(opts: { mode: 'blocks' | 'segment' }) {
  const auth: Record<string, string | null> = {}
  const bodies: Record<string, unknown> = {}
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const key = u.includes('planSnapshot')
      ? 'planSnapshot'
      : u.includes('getSegment')
        ? 'getSegment'
        : u.includes('getBlock')
          ? 'getBlock'
          : 'other'
    auth[key] = new Headers(init?.headers).get('authorization')
    if (init?.body != null) bodies[key] = JSON.parse(String(init.body))
    if (key === 'planSnapshot') return planResponse(opts.mode)
    if (key === 'getBlock') return new Response(goldenFrame, { status: 200 })
    // getSegment: fail fast so the test does not need valid segment framing.
    return new Response('server error', { status: 500 })
  }) as unknown as typeof fetch
  return { auth, bodies, impl }
}

async function drain(src: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const x of src) out.push(x)
  return out
}

// Captures the opts handed to the transport, then ends the stream. Tracks a
// call count too: `seen()` alone is ambiguous between "called with undefined
// opts" and "never called".
function captureTransport(): {
  calls: () => number
  seen: () => LiveTransportOpts | undefined
  transport: LiveTransport
} {
  let calls = 0
  let seen: LiveTransportOpts | undefined
  return {
    calls: () => calls,
    seen: () => seen,
    transport: {
      // eslint-disable-next-line require-yield -- captures opts, ends empty
      async *stream(_getUrl, _signal, opts) {
        calls++
        seen = opts
      },
    },
  }
}

describe('Jetstream apiKey — HTTP paths', () => {
  it('sends the bearer token on planSnapshot and getBlock during snapshot', async () => {
    const { auth, bodies, impl } = recordingFetch({ mode: 'blocks' })
    const js = new Jetstream({
      service: 'https://js.example',
      apiKey: 'secret1',
      fetchImpl: impl,
    })
    const batches = await drain(js.snapshotRawBatches({}))
    expect(batches).toHaveLength(1)
    expect(auth.planSnapshot).toBe('Bearer secret1')
    expect(auth.getBlock).toBe('Bearer secret1')
    // The wrapper must not eat the POST body planSnapshot rides on.
    expect(bodies.planSnapshot).toBeDefined()
  })

  it('sends the bearer token on getSegment during snapshot', async () => {
    const { auth, impl } = recordingFetch({ mode: 'segment' })
    const js = new Jetstream({
      service: 'https://js.example',
      apiKey: 'secret1',
      fetchImpl: impl,
      retry: { maxAttempts: 1 }, // no retry storm on the 500
    })
    // getSegment 500 → DownloadError; maxReplans: 0 makes the first
    // failure terminal instead of re-planning.
    await expect(
      drain(js.snapshotRawBatches({ maxReplans: 0 })),
    ).rejects.toThrow()
    expect(auth.getSegment).toBe('Bearer secret1')
  })

  it('sends the bearer token during replay backfill', async () => {
    const { auth, impl } = recordingFetch({ mode: 'blocks' })
    const js = new Jetstream({
      service: 'https://js.example',
      apiKey: 'secret1',
      fetchImpl: impl,
    })
    const batches: unknown[] = []
    for await (const b of js.replayRawBatches({})) {
      batches.push(b)
      break // backfill phase already ran; stop before the live phase connects
    }
    expect(batches).toHaveLength(1)
    expect(auth.planSnapshot).toBe('Bearer secret1')
    expect(auth.getBlock).toBe('Bearer secret1')
  })

  it('sends no authorization header when apiKey is unset', async () => {
    const { auth, impl } = recordingFetch({ mode: 'blocks' })
    const js = new Jetstream({ service: 'https://js.example', fetchImpl: impl })
    await drain(js.snapshotRawBatches({}))
    expect(auth.planSnapshot).toBeNull()
    expect(auth.getBlock).toBeNull()
  })
})

describe('Jetstream apiKey — live path', () => {
  it('hands the bearer header to the live transport', async () => {
    const cap = captureTransport()
    const js = new Jetstream({
      service: 'https://js.example',
      apiKey: 'secret1',
    })
    await drain(js.live({ raw: true, liveTransport: cap.transport }))
    expect(new Headers(cap.seen()?.headers).get('authorization')).toBe(
      'Bearer secret1',
    )
  })

  it('hands no headers to the live transport when apiKey is unset', async () => {
    const cap = captureTransport()
    const js = new Jetstream({ service: 'https://js.example' })
    await drain(js.live({ raw: true, liveTransport: cap.transport }))
    // Assert the transport was actually invoked, not just that `headers`
    // came back undefined.
    expect(cap.calls()).toBe(1)
    expect(cap.seen()?.headers).toBeUndefined()
  })

  it("hands the bearer header to replay's live phase", async () => {
    const cap = captureTransport()
    const { impl } = recordingFetch({ mode: 'blocks' })
    const js = new Jetstream({
      service: 'https://js.example',
      apiKey: 'secret1',
      fetchImpl: impl,
    })
    await drain(js.replayRawBatches({ liveTransport: cap.transport }))
    expect(new Headers(cap.seen()?.headers).get('authorization')).toBe(
      'Bearer secret1',
    )
  })
})

describe('Jetstream apiKey — validation', () => {
  it('throws at construction when apiKey is the empty string', () => {
    expect(
      () => new Jetstream({ service: 'https://js.example', apiKey: '' }),
    ).toThrow()
  })

  it('throws at construction when apiKey is whitespace-only', () => {
    expect(
      () => new Jetstream({ service: 'https://js.example', apiKey: '   ' }),
    ).toThrow()
  })

  it('throws at construction when apiKey contains an embedded newline', () => {
    expect(
      () =>
        new Jetstream({
          service: 'https://js.example',
          apiKey: 'sk_live_AAAA\nBBBB',
        }),
    ).toThrow()
  })

  it('throws at construction when apiKey contains an embedded carriage return', () => {
    expect(
      () =>
        new Jetstream({
          service: 'https://js.example',
          apiKey: 'sk_live_AAAA\rBBBB',
        }),
    ).toThrow()
  })

  it('throws at construction when apiKey contains an embedded NUL', () => {
    expect(
      () =>
        new Jetstream({
          service: 'https://js.example',
          apiKey: 'sk_live_AAAA\0BBBB',
        }),
    ).toThrow()
  })

  it('never echoes any part of a bad apiKey in the thrown message', () => {
    const secret = 'sk_live_AAAA\nsupersecretvalue'
    let message: string | undefined
    try {
      new Jetstream({ service: 'https://js.example', apiKey: secret })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toBeDefined()
    expect(message).not.toContain(secret)
    expect(message).not.toContain('supersecretvalue')
  })

  it('constructs fine with a valid apiKey and still authenticates (no regression)', async () => {
    const { auth, impl } = recordingFetch({ mode: 'blocks' })
    const js = new Jetstream({
      service: 'https://js.example',
      apiKey: 'secret1',
      fetchImpl: impl,
    })
    await drain(js.snapshotRawBatches({}))
    expect(auth.planSnapshot).toBe('Bearer secret1')
  })

  it('constructs fine with apiKey omitted and sends no auth header (no regression)', async () => {
    const cap = captureTransport()
    const js = new Jetstream({ service: 'https://js.example' })
    await drain(js.live({ raw: true, liveTransport: cap.transport }))
    expect(cap.calls()).toBe(1)
    expect(cap.seen()?.headers).toBeUndefined()
  })
})
