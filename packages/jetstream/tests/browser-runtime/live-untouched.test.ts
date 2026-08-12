// Runs with `#runtime` resolved to the browser branch: live() must work
// end to end without ever calling the archive shims.
import { describe, expect, it } from 'vitest'
import { Jetstream } from '../../src/index.js'
import { type LiveTransport } from '../../src/live/transport.js'

const NSID = 'network.bsky.jetstream.subscribeEvents'

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
            rev: '3jzfcijpj2z2a',
            operation: 'delete',
            collection: 'app.test.rec',
            rkey: `r${seq}`,
          },
        })
      }
    },
  }
}

describe('live() under the browser runtime', () => {
  it('streams events without touching the archive shims', async () => {
    const js = new Jetstream('https://js.example')
    const seqs: number[] = []
    for await (const ev of js.live({
      liveTransport: fakeTransport([1, 2, 3]),
    })) {
      seqs.push(ev.seq)
    }
    expect(seqs).toEqual([1, 2, 3])
  })
})
