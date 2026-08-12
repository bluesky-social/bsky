import { describe, expect, it } from 'vitest'
import { type Ack, type JetstreamConsumer } from '../../src/consumer.js'
import { type EventBatch, type RawEvent } from '../../src/event.js'

function rawDelete(seq: number): RawEvent {
  return {
    did: 'did:plc:a',
    seq,
    time: '2024-09-09T19:46:02.329308Z',
    kind: 'commit',
    commit: {
      operation: 'delete',
      collection: 'app.test.rec',
      rkey: 'r' + seq,
      rev: 'v',
    },
  }
}

async function* batches(...bs: EventBatch<RawEvent>[]) {
  for (const b of bs) yield b
}

describe('JetstreamConsumer seam', () => {
  it('a minimal consumer satisfies the interface, pulls batches, and acks', async () => {
    const acked: number[] = []
    const ack: Ack = (evt) => acked.push(evt.seq)

    const indexer: JetstreamConsumer = {
      collections: ['app.test.rec'],
      async run(stream, ctx) {
        for await (const batch of stream) {
          for (const evt of batch.events) ctx.ack(evt)
        }
      },
    }

    await indexer.run(
      batches({ events: [rawDelete(1), rawDelete(2)], lastCursor: 2 }),
      { ack }, // signal optional at the seam
    )
    expect(acked).toEqual([1, 2])
  })
})
