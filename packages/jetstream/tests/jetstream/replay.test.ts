import { describe, it, expect } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'
import type { LiveTransport } from '../../src/live/transport.js'

// planSnapshot fetch: one empty complete page (tip 0 -> live owns the stream).
function makeFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('planSnapshot')) {
      return new Response(
        JSON.stringify({
          plannedThroughSeq: 0,
          sealedTipSeq: 0,
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
    throw new Error(`unexpected ${u}`)
  }) as unknown as typeof fetch
}

const NSID = 'network.bsky.jetstream.subscribeEvents'

function liveTransport(seqs: number[]): LiveTransport {
  return {
    async *stream() {
      for (const seq of seqs) {
        yield new TextEncoder().encode(
          JSON.stringify({
            $type: 'message',
            payload: {
              $type: `${NSID}#commit`,
              seq,
              did: 'did:plc:a',
              time: '2024-09-09T19:46:02.329308Z',
              rev: 'v',
              operation: 'delete',
              collection: 'app.test.rec',
              rkey: `r${seq}`,
            },
          }),
        )
      }
    },
  }
}

describe('Jetstream.replay', () => {
  it('typed+single flattens the bufferless cutover output through shape()', async () => {
    const js = new Jetstream({
      service: 'https://js.example',
      fetchImpl: makeFetch(),
    })
    const out: number[] = []
    for await (const evt of js.replay({
      liveTransport: liveTransport([1, 2, 3]),
    })) {
      out.push(evt.seq)
    }
    expect(out).toEqual([1, 2, 3])
  })
})
