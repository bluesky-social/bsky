// tests/jetstream/live.test.ts
import { describe, expect, it } from 'vitest'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'
import { Jetstream } from '../../src/jetstream.js'
import { type LiveTransport } from '../../src/live/transport.js'

const te = new TextEncoder()

// transport that emits v1 JSON commit frames then ends
function fakeTransport(seqs: number[]): LiveTransport {
  return {
    async *stream() {
      for (const seq of seqs) {
        yield te.encode(
          JSON.stringify({
            did: 'did:plc:a',
            kind: 'commit',
            time_us: seq,
            commit: {
              operation: 'delete',
              collection: 'app.test.rec',
              rkey: 'r' + seq,
              rev: 'rev',
            },
          }),
        )
      }
    },
  }
}

describe('Jetstream.live', () => {
  it('typed yields one TypedEvent per frame', async () => {
    const js = new Jetstream({ service: 'https://js.example' })
    const out: number[] = []
    for await (const evt of js.live({
      liveTransport: fakeTransport([1, 2, 3]),
    })) {
      out.push(evt.seq)
    }
    expect(out).toEqual([1, 2, 3])
  })

  it('reads resume cursor from the store as the dedup floor', async () => {
    const store = new MemoryCursorStore()
    await store.save(2)
    const js = new Jetstream({ service: 'https://js.example' })
    const out: number[] = []
    for await (const evt of js.live({
      cursor: store,
      liveTransport: fakeTransport([1, 2, 3]),
    })) {
      out.push(evt.seq)
    }
    // seq <= 2 deduped; only 3 survives
    expect(out).toEqual([3])
  })
})
