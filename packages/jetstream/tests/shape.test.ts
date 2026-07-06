// tests/shape.test.ts
import { describe, expect, it } from 'vitest'
import {
  type EventBatch,
  type RawEventV1,
  type TypedEvent,
} from '../src/event.js'
import { shape } from '../src/shape.js'

function rawCreate(seq: number, record: unknown): RawEventV1 {
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

describe('shape', () => {
  const b1: EventBatch<RawEventV1> = {
    events: [rawCreate(1, {}), rawCreate(2, {})],
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
      expect(out[0].commit.record).toEqual({})
    }
  })
})
