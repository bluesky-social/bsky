import {
  type DidString,
  type InferOutput,
  type NsidString,
  type TypedLexMap,
  l,
  record,
} from '@atproto/lex'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Jetstream, type RawRecordJson } from '../../src/index.js'
import type { LiveTransport } from '../../src/live/transport.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)
type Like = InferOutput<typeof likeSchema>

function frame(seq: number, collection: string, rec: unknown): string {
  return JSON.stringify({
    did: 'did:plc:a',
    time_us: seq,
    kind: 'commit',
    commit: {
      rev: 'v',
      operation: 'create',
      collection,
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

describe('live() filter narrowing (public API)', () => {
  it('mixed filters: correlated narrowing + validation skip, end to end', async () => {
    const jetstream = new Jetstream({ service: 'https://js.example' })
    const likes: Like[] = []
    const posts: number[] = []
    for await (const ev of jetstream.live({
      collections: [likeSchema, 'app.test.post'],
      liveTransport: fakeTransport([
        frame(1, 'app.test.like', { $type: 'app.test.like', subject: 'ok' }),
        frame(2, 'app.test.like', { $type: 'app.test.like', subject: 9 }), // invalid: skipped
        frame(3, 'app.test.post', { $type: 'app.test.post', anything: 1 }),
      ]),
    })) {
      // collection narrows across the whole union
      expectTypeOf(ev.did).toEqualTypeOf<DidString>()
      if (ev.kind === 'commit' && ev.commit.operation !== 'delete') {
        if (ev.commit.collection === 'app.test.like') {
          expectTypeOf(ev.commit.record).toEqualTypeOf<Like>()
          likes.push(ev.commit.record)
        }
        if (ev.commit.collection === 'app.test.post') {
          expectTypeOf(ev.commit.record).toEqualTypeOf<
            TypedLexMap<'app.test.post'>
          >()
          posts.push(ev.seq)
        }
      }
    }
    expect(likes.map((r) => r.subject)).toEqual(['ok'])
    expect(posts).toEqual([3])
  })

  it('no collections filter still yields plain TypedEvent', async () => {
    const jetstream = new Jetstream({ service: 'https://js.example' })
    for await (const ev of jetstream.live({
      liveTransport: fakeTransport([
        frame(1, 'app.test.like', { $type: 'app.test.like', subject: 'ok' }),
      ]),
    })) {
      if (ev.kind === 'commit' && ev.commit.operation !== 'delete') {
        expectTypeOf(ev.commit.record).toEqualTypeOf<TypedLexMap>()
        expectTypeOf(ev.commit.collection).toEqualTypeOf<NsidString>()
      }
    }
  })

  it('raw mode is untouched by schema filters (no skip, RawEventV1 shape)', async () => {
    const jetstream = new Jetstream({ service: 'https://js.example' })
    const seqs: number[] = []
    for await (const ev of jetstream.live({
      raw: true,
      collections: [likeSchema],
      liveTransport: fakeTransport([
        frame(1, 'app.test.like', { $type: 'app.test.like', subject: 9 }), // schema-invalid
      ]),
    })) {
      seqs.push(ev.seq)
      if (ev.kind === 'commit' && ev.commit.operation !== 'delete') {
        expectTypeOf(ev.commit.record).toEqualTypeOf<RawRecordJson>()
      }
    }
    expect(seqs).toEqual([1]) // invalid record NOT skipped in raw mode
  })
})
