import { describe, expect, it } from 'vitest'
import { type EventBatch, type RawEvent } from '../../src/event.js'
import { type CursorStore } from '../../src/execute/cursor-store.js'
import { trackedStream } from '../../src/run-tracker.js'

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

class RecordingStore implements CursorStore {
  saved: number[] = []
  private v: number | undefined
  async load() {
    return this.v
  }
  async save(seq: number) {
    this.v = seq
    this.saved.push(seq)
  }
}

describe('trackedStream', () => {
  it('passes batches through unchanged', async () => {
    const ts = trackedStream(
      batches({ events: [rawDelete(1), rawDelete(2)], lastCursor: 2 }),
    )
    const seqs: number[] = []
    for await (const batch of ts.stream) {
      for (const e of batch.events) seqs.push(e.seq)
    }
    expect(seqs).toEqual([1, 2])
  })

  it('advances the saved cursor only to the highest CONTIGUOUS acked seq', async () => {
    const store = new RecordingStore()
    const ts = trackedStream(
      batches({
        events: [rawDelete(1), rawDelete(2), rawDelete(3)],
        lastCursor: 3,
      }),
      store,
    )
    // Pull all (registers track(1),track(2),track(3) in order)
    const events: RawEvent[] = []
    for await (const batch of ts.stream) events.push(...batch.events)

    // Ack out of order: 1, then 3 (2 still pending) — watermark must stay at 1
    ts.ack(events[0]) // seq 1
    ts.ack(events[2]) // seq 3 — but 2 is a gap
    await ts.flush()
    expect(store.saved.at(-1)).toBe(1)

    // Now ack 2 — contiguous prefix jumps to 3
    ts.ack(events[1]) // seq 2
    await ts.flush()
    expect(store.saved.at(-1)).toBe(3)
  })

  it('flush with no store is a no-op (does not throw)', async () => {
    const ts = trackedStream(batches({ events: [rawDelete(1)], lastCursor: 1 }))
    for await (const _ of ts.stream) {
      /* drain */
    }
    await ts.flush()
  })
})
