import { l, record } from '@atproto/lex'
import { describe, expect, it, test } from 'vitest'
import { parseCollectionFilters } from '../src/engine/collections.js'
import {
  type EventBatch,
  type RawEventV1,
  type TypedEvent,
} from '../src/event.js'
import { type RawRecordJson } from '../src/raw-record.js'
import { RecordValidationError, shape } from '../src/shape.js'

function rawCreate(seq: number, record: RawRecordJson): RawEventV1 {
  return {
    did: 'did:plc:a',
    seq,
    timeUs: 0,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.test.rec',
      rkey: 'r' + seq,
      rev: 'rev',
      cid: 'cid',
      record,
    },
  }
}

async function* batches(...bs: EventBatch<RawEventV1>[]) {
  for (const b of bs) yield b
}

async function collect<T>(src: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of src) out.push(x)
  return out
}

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

function putEvent(seq: number, rec: RawRecordJson): RawEventV1 {
  return {
    did: 'did:plc:a',
    seq,
    timeUs: 0,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.test.like',
      rkey: 'r' + seq,
      rev: 'v',
      cid: 'cid' + seq,
      record: rec,
    },
  }
}

function oneBatch(events: RawEventV1[]): AsyncIterable<EventBatch<RawEventV1>> {
  return (async function* () {
    yield { events, lastCursor: events[events.length - 1]?.seq ?? 0 }
  })()
}

describe('shape', () => {
  const b1: EventBatch<RawEventV1> = {
    events: [
      rawCreate(1, { $type: 'app.test.rec' }),
      rawCreate(2, { $type: 'app.test.rec' }),
    ],
    lastCursor: 2,
  }

  it('raw: flattens batches to raw events', async () => {
    const out = (await collect(
      shape(batches(b1), { raw: true }, new Map()),
    )) as RawEventV1[]
    expect(out.map((e) => e.seq)).toEqual([1, 2])
    expect(out[0].kind).toBe('commit')
  })

  it('typed: upgrades each raw event', async () => {
    const out = (await collect(
      shape(batches(b1), {}, new Map()),
    )) as TypedEvent[]
    expect(out).toHaveLength(2)
    expect(out[0].kind).toBe('commit')
    expect(out[0].kind === 'commit' && out[0].commit.operation).not.toBe(
      'delete',
    )
    if (out[0].kind === 'commit' && out[0].commit.operation !== 'delete') {
      expect(out[0].commit.record).toEqual({ $type: 'app.test.rec' })
    }
  })
})

test('typed path skips schema-invalid records and reports RecordValidationError', async () => {
  const { schemasByNsid } = parseCollectionFilters([likeSchema])
  const errors: Error[] = []
  const out: TypedEvent[] = []
  for await (const ev of shape(
    oneBatch([
      putEvent(1, { $type: 'app.test.like', subject: 'ok' }),
      putEvent(2, { $type: 'app.test.like', subject: 123 }), // invalid
    ]),
    {},
    schemasByNsid,
    (err) => errors.push(err),
  )) {
    out.push(ev as TypedEvent)
  }
  expect(out.map((e) => e.seq)).toEqual([1])
  expect(errors).toHaveLength(1)
  const err = errors[0]
  expect(err).toBeInstanceOf(RecordValidationError)
  if (!(err instanceof RecordValidationError)) throw new Error('unreachable')
  expect(err.seq).toBe(2)
  expect(err.collection).toBe('app.test.like')
  expect(err.rkey).toBe('r2')
})

test('unregistered collections are never skipped and never reported', async () => {
  // no schema registered: same events must NOT be skipped
  const errors: Error[] = []
  const out: TypedEvent[] = []
  for await (const ev of shape(
    oneBatch([putEvent(1, { $type: 'app.test.like', subject: 123 })]),
    {},
    new Map(),
    (err) => errors.push(err),
  )) {
    out.push(ev as TypedEvent)
  }
  expect(out.map((e) => e.seq)).toEqual([1])
  expect(errors).toHaveLength(0)
})

test('raw paths never skip', async () => {
  const { schemasByNsid } = parseCollectionFilters([likeSchema])
  const out: unknown[] = []
  for await (const ev of shape(
    oneBatch([putEvent(1, { $type: 'app.test.like', subject: 123 })]),
    { raw: true },
    schemasByNsid,
    () => {
      throw new Error('raw path must not report')
    },
  )) {
    out.push(ev)
  }
  expect(out).toHaveLength(1)
})
