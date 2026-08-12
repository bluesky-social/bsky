import { type TypedLexMap, l, record } from '@atproto/lex'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { type EventBatch, type RawEvent } from '../../src/event.js'
import { LexIndexer } from '../../src/index.js'
import { type RawRecordJson } from '../../src/raw-record.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

function putWithRecord(seq: number, rec: RawRecordJson): RawEvent {
  return {
    did: 'did:plc:a',
    seq,
    time: '2024-09-09T19:46:02.329308Z',
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

function oneBatch(events: RawEvent[]): AsyncIterable<EventBatch<RawEvent>> {
  return (async function* () {
    yield { events, lastCursor: events[events.length - 1]?.seq ?? 0 }
  })()
}

describe('commit validateRecord', () => {
  it('options form with validation (default): invalid record -> onValidationError', async () => {
    const puts: number[] = []
    const invalid: number[] = []
    const idx = new LexIndexer()
      .commit({
        collection: likeSchema,
        handlers: { put: (e) => puts.push(e.seq) },
      })
      .onValidationError((e) => invalid.push(e.seq))
    // subject: 123 fails l.string()
    await idx.run(
      oneBatch([
        putWithRecord(1, { $type: 'app.test.like', subject: 'ok' }),
        putWithRecord(2, { $type: 'app.test.like', subject: 123 }),
      ]),
      { ack: () => {} },
    )
    expect(puts).toEqual([1])
    expect(invalid).toEqual([2])
  })

  it('validateRecord: false: no schema checks — schema-invalid records still reach put', async () => {
    const puts: number[] = []
    const invalid: number[] = []
    const idx = new LexIndexer()
      .commit({
        collection: likeSchema,
        validateRecord: false,
        handlers: {
          put: (e) => {
            expectTypeOf(e.record).toEqualTypeOf<TypedLexMap<'app.test.like'>>()
            puts.push(e.seq)
          },
        },
      })
      .onValidationError((e) => invalid.push(e.seq))
    await idx.run(
      oneBatch([
        putWithRecord(1, { $type: 'app.test.like', subject: 123 }), // schema-invalid: OK
        putWithRecord(2, { $type: 'app.test.like', extra: 'no schema check' }), // schema-invalid: OK
      ]),
      { ack: () => {} },
    )
    expect(puts).toEqual([1, 2])
    expect(invalid).toEqual([])
  })

  it('validateRecord: false still routes ONLY the registered collection', async () => {
    const puts: number[] = []
    const other: RawEvent = {
      ...putWithRecord(3, { $type: 'app.test.other' }),
    }
    ;(other as { commit: { collection: string } }).commit.collection =
      'app.test.other'
    const idx = new LexIndexer().commit({
      collection: likeSchema,
      validateRecord: false,
      handlers: { put: (e) => puts.push(e.seq) },
    })
    await idx.run(
      oneBatch([putWithRecord(1, { $type: 'app.test.like' }), other]),
      { ack: () => {} },
    )
    expect(puts).toEqual([1]) // app.test.other skipped (unregistered), not delivered
  })

  it('simple two-arg form still works and validates', async () => {
    const puts: number[] = []
    const idx = new LexIndexer().commit(likeSchema, {
      put: (e) => {
        // The simple form keeps the schema-inferred record type (which carries
        // a branded $type plus the typed fields), NOT the loose unvalidated
        // TypedLexMap. Assert the load-bearing distinction: the typed
        // `subject: string` is present and the record is not a bare TypedLexMap.
        expectTypeOf(e.record.subject).toEqualTypeOf<string>()
        expectTypeOf(e.record).not.toEqualTypeOf<TypedLexMap>()
        puts.push(e.seq)
      },
    })
    await idx.run(
      oneBatch([putWithRecord(1, { $type: 'app.test.like', subject: 'ok' })]),
      { ack: () => {} },
    )
    expect(puts).toEqual([1])
  })
})
