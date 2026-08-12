import { l, record } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import { Jetstream, LexIndexer, MemoryCursorStore } from '../../src/index.js'
import { type LiveTransport } from '../../src/live/transport.js'

const NSID = 'network.bsky.jetstream.subscribeEvents'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

function likeFrame(seq: number, subject: string): string {
  return JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#commit`,
      seq,
      did: 'did:plc:a',
      time: '2024-09-09T19:46:02.329308Z',
      operation: 'create',
      collection: 'app.test.like',
      rkey: 'r' + seq,
      rev: 'v',
      cid: 'cid' + seq,
      record: { $type: 'app.test.like', subject },
    },
  })
}

function fakeTransport(frames: string[]): LiveTransport {
  return {
    async *stream() {
      for (const f of frames) yield f
    },
  }
}

describe('integration: jetstream.runner(LexIndexer)', () => {
  it('runs a LexIndexer over a live source, dispatches typed records, persists cursor', async () => {
    const subjects: string[] = []
    const store = new MemoryCursorStore()
    const indexer = new LexIndexer().commit(likeSchema, {
      put: (e, ctx) => {
        // ctx.signal is always present; a real handler would thread it into
        // fetch(...,{ signal: ctx.signal })
        expect(ctx.signal).toBeInstanceOf(AbortSignal)
        subjects.push(e.record.subject)
      },
    })
    const js = new Jetstream({ service: 'https://js.example' })
    await js.runner(indexer).live({
      cursor: store,
      liveTransport: fakeTransport([likeFrame(1, 's1'), likeFrame(2, 's2')]),
    })
    expect(subjects).toEqual(['s1', 's2'])
    expect(await store.load()).toBe(2)
  })
})
