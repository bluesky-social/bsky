import { l, record } from '@atproto/lex-schema'
import { describe, expect, it } from 'vitest'
import { Jetstream, RecordValidationError } from '../../src/index.js'
import type { LiveTransport } from '../../src/live/transport.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

function frame(seq: number, rec: unknown): string {
  return JSON.stringify({
    did: 'did:plc:a',
    time_us: seq,
    kind: 'commit',
    commit: {
      rev: 'v',
      operation: 'create',
      collection: 'app.test.like',
      rkey: 'r' + seq,
      cid: 'cid' + seq,
      record: rec,
    },
  })
}

function fakeTransport(frames: string[]): LiveTransport {
  return {
    stream() {
      return (async function* () {
        for (const f of frames) yield new TextEncoder().encode(f)
      })()
    },
  }
}

describe('live() with a validating schema filter', () => {
  it('yields only valid records; invalid ones go to onError as RecordValidationError', async () => {
    const jetstream = new Jetstream({ service: 'https://js.example' })
    const errors: Error[] = []
    const seqs: number[] = []
    for await (const ev of jetstream.live({
      collections: [likeSchema],
      liveTransport: fakeTransport([
        frame(1, { $type: 'app.test.like', subject: 'ok' }),
        frame(2, { $type: 'app.test.like', subject: 123 }), // invalid
        frame(3, { $type: 'app.test.like', subject: 'ok' }),
      ]),
      onError: (err) => errors.push(err),
    })) {
      seqs.push(ev.seq)
    }
    expect(seqs).toEqual([1, 3])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(RecordValidationError)
  })
})
