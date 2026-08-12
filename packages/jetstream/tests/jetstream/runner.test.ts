import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { l, record } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import { type JetstreamConsumer } from '../../src/consumer.js'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'
import { Jetstream, JetstreamRunner, LexIndexer } from '../../src/index.js'
import { type LiveTransport } from '../../src/live/transport.js'

const NSID = 'network.bsky.jetstream.subscribeEvents'
// A well-formed TID (13-char base32-sortable) — wire-valid even though no
// test here enables validateWire, so a strict-mode test added later doesn't
// fail on this fixture for an unrelated reason.
const TID = '3jzfcijpj2z2a'

// fake transport emitting v2 delete-commit frames then ending
function fakeTransport(seqs: number[]): LiveTransport {
  return {
    async *stream() {
      for (const seq of seqs) {
        yield JSON.stringify({
          $type: 'message',
          payload: {
            $type: `${NSID}#commit`,
            seq,
            did: 'did:plc:a',
            time: '2024-09-09T19:46:02.329308Z',
            rev: TID,
            operation: 'delete',
            collection: 'app.test.rec',
            rkey: 'r' + seq,
          },
        })
      }
    },
  }
}

// Records the request URL(s) and ends the stream immediately (no frames) —
// enough to observe what the runner asked the wire for.
function urlRecordingTransport(): { transport: LiveTransport; urls: string[] } {
  const urls: string[] = []
  return {
    transport: {
      // eslint-disable-next-line require-yield
      async *stream(getUrl) {
        urls.push(getUrl())
      },
    },
    urls,
  }
}

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

describe('JetstreamRunner', () => {
  it('drives a live indexer end to end and persists the contiguous watermark', async () => {
    const store = new MemoryCursorStore()
    const seen: number[] = []
    const indexer: JetstreamConsumer = {
      collections: ['app.test.rec'],
      async run(stream, { ack }) {
        for await (const batch of stream) {
          for (const evt of batch.events) {
            seen.push(evt.seq)
            ack(evt)
          }
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example' })
    await js.runner(indexer).live({
      cursor: store,
      liveTransport: fakeTransport([1, 2, 3]),
    })
    expect(seen).toEqual([1, 2, 3])
    expect(await store.load()).toBe(3)
  })

  it('flushes the cursor even when the indexer throws (watermark holds at last contiguous ack)', async () => {
    const store = new MemoryCursorStore()
    const indexer: JetstreamConsumer = {
      async run(stream, { ack }) {
        for await (const batch of stream) {
          for (const evt of batch.events) {
            if (evt.seq === 2) throw new Error('boom') // ack 1, then fail on 2
            ack(evt)
          }
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example' })
    await expect(
      js.runner(indexer).live({
        cursor: store,
        liveTransport: fakeTransport([1, 2, 3]),
      }),
    ).rejects.toThrow('boom')
    // seq 1 was acked before the throw; flush persisted it; 2/3 never acked
    expect(await store.load()).toBe(1)
  })

  it('forwards the caller signal to the seam ctx (optional — undefined when not passed)', async () => {
    const seen: Array<AbortSignal | undefined> = []
    const indexer: JetstreamConsumer = {
      async run(stream, ctx) {
        seen.push(ctx.signal)
        for await (const batch of stream) {
          for (const evt of batch.events) ctx.ack(evt)
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example' })

    // (a) no caller signal -> seam ctx.signal is undefined
    await js.runner(indexer).live({ liveTransport: fakeTransport([1]) })
    expect(seen[0]).toBeUndefined()

    // (b) caller signal -> forwarded as the same instance
    const ac = new AbortController()
    await js.runner(indexer).live({
      signal: ac.signal,
      liveTransport: fakeTransport([2]),
    })
    expect(seen[1]).toBe(ac.signal)
  })

  it('explicit construction behaves like the factory', async () => {
    const store = new MemoryCursorStore()
    const seen: number[] = []
    const indexer: JetstreamConsumer = {
      collections: ['app.test.rec'],
      async run(stream, { ack }) {
        for await (const batch of stream) {
          for (const evt of batch.events) {
            seen.push(evt.seq)
            ack(evt)
          }
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example' })
    const runner = new JetstreamRunner(js, indexer)
    await runner.live({
      cursor: store,
      liveTransport: fakeTransport([1, 2, 3]),
    })
    expect(seen).toEqual([1, 2, 3])
    expect(await store.load()).toBe(3)
  })

  // golden_block.bin = 3 sealed rows at seq 1,2,3.
  const goldenFrame = new Uint8Array(
    readFileSync(
      fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
    ),
  )

  function archiveFetch(pages: Array<Record<string, unknown>>): typeof fetch {
    let planCall = 0
    return (async (url: string | URL) => {
      const u = String(url)
      if (u.includes('planSnapshot')) {
        const page = pages[Math.min(planCall, pages.length - 1)]
        planCall++
        return new Response(
          JSON.stringify({
            stats: {
              segmentsExamined: 0,
              segmentsMatched: 0,
              blocksMatched: 0,
              entries: 0,
            },
            ...page,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (u.includes('getBlock'))
        return new Response(goldenFrame, { status: 200 })
      throw new Error(`unexpected ${u}`)
    }) as unknown as typeof fetch
  }

  const SEALED_ENTRY = {
    name: 'a.jss',
    index: 0,
    checksum: 'x'.repeat(16),
    minSeq: 1,
    maxSeq: 3,
    mode: 'blocks',
    blocks: [{ first: 0, last: 0 }],
  }

  it('replay mode: pages backfill then cuts to live, persisting the cursor monotonically', async () => {
    // Two plan pages prove the paged cutover delivers the whole archive
    // before the live tail (4,5).
    const fetchImpl = archiveFetch([
      { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
      { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
    ])
    const store = new MemoryCursorStore()
    const seen: number[] = []
    const indexer: JetstreamConsumer = {
      async run(stream, { ack }) {
        for await (const batch of stream) {
          for (const evt of batch.events) {
            seen.push(evt.seq)
            ack(evt)
          }
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example', fetchImpl })
    await js.runner(indexer).replay({
      cursor: store,
      liveTransport: fakeTransport([4, 5]),
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(await store.load()).toBe(5)
  })

  it('snapshot mode: drives the archive backfill only and persists the watermark', async () => {
    const fetchImpl = archiveFetch([
      { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
    ])
    const store = new MemoryCursorStore()
    const seen: number[] = []
    const indexer: JetstreamConsumer = {
      async run(stream, { ack }) {
        for await (const batch of stream) {
          for (const evt of batch.events) {
            seen.push(evt.seq)
            ack(evt)
          }
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example', fetchImpl })
    await js.runner(indexer).snapshot({ cursor: store })
    expect(seen).toEqual([1, 2, 3])
    expect(await store.load()).toBe(3)
  })

  it('snapshot mode resumes from the cursor store', async () => {
    // The store holds 3; the plan must be asked for afterSeq=3 and comes back
    // empty (already at the tip).
    let planAfterSeq: number | undefined
    const fetchImpl = (async (
      url: string | URL,
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (String(url).includes('planSnapshot')) {
        const body = init?.body != null ? JSON.parse(String(init.body)) : {}
        planAfterSeq = body.afterSeq
        return new Response(
          JSON.stringify({
            plannedThroughSeq: 3,
            sealedTipSeq: 3,
            segments: [],
            stats: {
              segmentsExamined: 0,
              segmentsMatched: 0,
              blocksMatched: 0,
              entries: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error('unexpected')
    }) as unknown as typeof fetch
    const store = new MemoryCursorStore()
    await store.save(3)
    const seen: number[] = []
    const indexer: JetstreamConsumer = {
      async run(stream, { ack }) {
        for await (const batch of stream) {
          for (const evt of batch.events) {
            seen.push(evt.seq)
            ack(evt)
          }
        }
      },
    }
    const js = new Jetstream({ service: 'https://js.example', fetchImpl })
    await js.runner(indexer).snapshot({ cursor: store })
    expect(planAfterSeq).toBe(3)
    expect(seen).toEqual([])
    expect(await store.load()).toBe(3)
  })

  it("derives the wire request from the consumer's registrations (collections + kinds)", async () => {
    // A commit collection plus a sync handler, and nothing else registered:
    // kinds should list exactly commit and sync, never identity/account.
    const ix = new LexIndexer()
      .commit(likeSchema, { put: () => {} })
      .sync(() => {})
    const { transport, urls } = urlRecordingTransport()
    const js = new Jetstream({ service: 'https://js.example' })
    await js.runner(ix).live({ liveTransport: transport })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('collections=app.test.like')
    expect(urls[0]).toContain('kinds=commit')
    expect(urls[0]).toContain('kinds=sync')
    expect(urls[0]).not.toContain('kinds=identity')
    expect(urls[0]).not.toContain('kinds=account')
  })
})
