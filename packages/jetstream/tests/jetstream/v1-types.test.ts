import { describe, expectTypeOf, it } from 'vitest'
import type {
  Ack,
  EventBatch,
  JetstreamConsumer,
  RawEventV1,
  SeqEvent,
  TypedEvent,
} from '../../src/index.js'
import { Jetstream } from '../../src/index.js'
import { liveEvents } from '../../src/live/source.js'

describe('live() types', () => {
  it('raw live yields RawEventV1; typed live yields TypedEvent', () => {
    const js = new Jetstream('https://h')

    expectTypeOf(js.live({ raw: true })).toEqualTypeOf<
      AsyncGenerator<RawEventV1>
    >()
    expectTypeOf(js.live()).toEqualTypeOf<AsyncGenerator<TypedEvent>>()
  })
})

describe('SeqEvent envelope', () => {
  it('liveEvents declares RawEventV1', () => {
    expectTypeOf(liveEvents({ host: 'https://h' })).toEqualTypeOf<
      AsyncGenerator<RawEventV1>
    >()
  })

  it('the consumer seam element is RawEventV1 and satisfies SeqEvent', () => {
    type SeamStream = Parameters<JetstreamConsumer['run']>[0]
    expectTypeOf<SeamStream>().toEqualTypeOf<
      AsyncIterable<EventBatch<RawEventV1>>
    >()
    // Every seam element satisfies the minimal envelope.
    expectTypeOf<RawEventV1>().toMatchTypeOf<SeqEvent>()
  })

  it('a consumer cannot read recordCbor (v1 carries parsed JSON records)', () => {
    const readCbor = (ev: RawEventV1): Uint8Array | undefined => {
      if (ev.kind !== 'commit') return undefined
      // @ts-expect-error recordCbor is not present on v1 commits; reading it
      // is a compile error — the honest surface.
      return ev.commit.recordCbor
    }
    expectTypeOf(readCbor).toBeFunction()
  })

  it('Ack accepts any { seq: number }', () => {
    // Ack only reads the cursor, so it takes the minimal SeqEvent — any object
    // carrying a numeric seq is assignable.
    expectTypeOf<Ack>().parameter(0).toEqualTypeOf<SeqEvent>()
    const ack = ((_evt: SeqEvent) => {}) as Ack
    ack({ seq: 1 }) // a bare { seq } — not a full RawEventV1
    expectTypeOf(ack).toBeCallableWith({ seq: 42 })
  })
})
