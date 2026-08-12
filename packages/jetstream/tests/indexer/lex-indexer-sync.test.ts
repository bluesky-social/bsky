import { describe, expect, it } from 'vitest'
import { type EventBatch, type RawEvent } from '../../src/event.js'
import { LexIndexer, type SyncEvent } from '../../src/index.js'

const syncEvent = (seq: number): RawEvent => ({
  did: 'did:plc:a' as never,
  seq,
  time: '2024-09-09T19:46:02.329308Z' as never,
  kind: 'sync',
  sync: {
    did: 'did:plc:a' as never,
    rev: '3kabc' as never,
    time: '2024-09-09T19:46:02.329308Z' as never,
  },
})

async function* batches(
  evts: RawEvent[],
): AsyncGenerator<EventBatch<RawEvent>> {
  for (const e of evts) yield { events: [e], lastCursor: e.seq }
}

describe('LexIndexer.sync', () => {
  it('dispatches sync events and acks them', async () => {
    const seen: SyncEvent[] = []
    const acked: number[] = []
    const ix = new LexIndexer().sync((e) => {
      seen.push(e)
    })
    await ix.run(batches([syncEvent(1), syncEvent(2)]), {
      ack: (e) => acked.push(e.seq),
    })
    expect(seen.map((e) => e.seq)).toEqual([1, 2])
    expect(seen[0]).toMatchObject({ did: 'did:plc:a', rev: '3kabc' })
    expect(acked).toEqual([1, 2])
  })

  it('acks sync events as no-ops when no handler is registered', async () => {
    const acked: number[] = []
    const ix = new LexIndexer()
    await ix.run(batches([syncEvent(1)]), { ack: (e) => acked.push(e.seq) })
    expect(acked).toEqual([1])
  })

  it('surfaces a handler failure and holds the watermark', async () => {
    const acked: number[] = []
    const ix = new LexIndexer().sync(() => {
      throw new Error('handler boom')
    })
    await expect(
      ix.run(batches([syncEvent(1)]), { ack: (e) => acked.push(e.seq) }),
    ).rejects.toThrow('handler boom')
    expect(acked).toEqual([])
  })

  it('passes the handler context signal', async () => {
    let aborted: boolean | undefined
    const ix = new LexIndexer().sync((_e, ctx) => {
      aborted = ctx.signal.aborted
    })
    await ix.run(batches([syncEvent(1)]), { ack: () => {} })
    expect(aborted).toBe(false)
  })
})
