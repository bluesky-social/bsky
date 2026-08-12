import { describe, expectTypeOf, it } from 'vitest'
import {
  type Ack,
  type EventBase,
  type EventBaseV1,
  type EventBatch,
  Jetstream,
  type JetstreamConsumer,
  type RawEvent,
  type RawEventV1,
  type RawRecordJson,
  type SeqEvent,
  type Sync,
  type TypedEvent,
} from '../../src/index.js'

describe('the two wires have their own envelopes', () => {
  it('v1 carries timeUs (which is its cursor); v2 carries a datetime string', () => {
    expectTypeOf<EventBaseV1['timeUs']>().toEqualTypeOf<number>()
    expectTypeOf<EventBase['time']>().toBeString()
    // No cross-contamination: neither envelope carries the other's field.
    expectTypeOf<EventBase>().not.toHaveProperty('timeUs')
    expectTypeOf<EventBaseV1>().not.toHaveProperty('time')
  })

  it('kind sets differ — only v2 emits sync', () => {
    expectTypeOf<RawEventV1['kind']>().toEqualTypeOf<
      'commit' | 'identity' | 'account'
    >()
    expectTypeOf<RawEvent['kind']>().toEqualTypeOf<
      'commit' | 'identity' | 'account' | 'sync'
    >()
    type SyncArm = Extract<RawEvent, { kind: 'sync' }>
    expectTypeOf<SyncArm['sync']>().toEqualTypeOf<Sync>()
  })

  it('a v1 event is deliberately NOT a RawEvent', () => {
    // The envelopes diverge, so the v2-only consumer path cannot be fed v1
    // events by accident.
    expectTypeOf<RawEventV1>().not.toExtend<RawEvent>()
  })

  it('both satisfy the minimal tracking envelope', () => {
    expectTypeOf<RawEvent>().toExtend<SeqEvent>()
    expectTypeOf<RawEventV1>().toExtend<SeqEvent>()
  })

  it('the commit payload is shared', () => {
    type V1Commit = Extract<RawEventV1, { kind: 'commit' }>['commit']
    type V2Commit = Extract<
      RawEvent<RawRecordJson>,
      { kind: 'commit' }
    >['commit']
    expectTypeOf<V1Commit>().toEqualTypeOf<V2Commit>()
  })

  it('a put record is wire JSON, and recordCbor does not exist', () => {
    const readCbor = (ev: RawEvent): unknown => {
      if (ev.kind !== 'commit' || ev.commit.operation === 'delete') return
      // @ts-expect-error the v2 wire has no recordCbor field
      return ev.commit.recordCbor
    }
    expectTypeOf(readCbor).toBeFunction()
  })
})

describe('consumer seam', () => {
  it('the seam element is the v2 RawEvent', () => {
    type SeamStream = Parameters<JetstreamConsumer['run']>[0]
    expectTypeOf<SeamStream>().toEqualTypeOf<
      AsyncIterable<EventBatch<RawEvent>>
    >()
  })

  it('Ack accepts any { seq: number }', () => {
    expectTypeOf<Ack>().parameter(0).toEqualTypeOf<SeqEvent>()
    const ack = ((_evt: SeqEvent) => {}) as Ack
    expectTypeOf(ack).toBeCallableWith({ seq: 42 })
  })
})

describe('Jetstream is v2-backed', () => {
  it('live()/liveRawBatches() promise v2 JSON-arm shapes', () => {
    const js = new Jetstream('https://h')
    expectTypeOf(js.live({ raw: true })).toEqualTypeOf<
      AsyncGenerator<RawEvent<RawRecordJson>>
    >()
    expectTypeOf(js.live()).toEqualTypeOf<AsyncGenerator<TypedEvent>>()
    expectTypeOf(js.liveRawBatches({})).toEqualTypeOf<
      AsyncGenerator<EventBatch<RawEvent<RawRecordJson>>>
    >()
  })
})
