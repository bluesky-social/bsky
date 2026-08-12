import { describe, expect, it } from 'vitest'
import { type JetstreamConsumer } from '../../src/consumer.js'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'
import { Jetstream, JetstreamRunner } from '../../src/index.js'
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
})
