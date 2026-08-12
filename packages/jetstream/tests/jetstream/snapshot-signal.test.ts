import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'

const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

// A plan with two entries; both getBlock calls return the golden frame.
function makeFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('planSnapshot')) {
      return new Response(
        JSON.stringify({
          plannedThroughSeq: 6,
          sealedTipSeq: 6,
          segments: [
            {
              name: 'a.jss',
              index: 0,
              checksum: 'x'.repeat(16),
              minSeq: 1,
              maxSeq: 3,
              mode: 'blocks',
              blocks: [{ first: 0, last: 0 }],
            },
            {
              name: 'b.jss',
              index: 1,
              checksum: 'y'.repeat(16),
              minSeq: 4,
              maxSeq: 6,
              mode: 'blocks',
              blocks: [{ first: 0, last: 0 }],
            },
          ],
          stats: {
            segmentsExamined: 2,
            segmentsMatched: 2,
            blocksMatched: 2,
            entries: 2,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (u.includes('getBlock'))
      return new Response(goldenFrame, { status: 200 })
    throw new Error(`unexpected url ${u}`)
  }) as unknown as typeof fetch
}

test('backfill: a pre-aborted signal yields no events', async () => {
  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: makeFetch(),
  })
  const ac = new AbortController()
  ac.abort()
  const events = []
  for await (const e of js.snapshot({ signal: ac.signal, raw: true }))
    events.push(e)
  expect(events).toHaveLength(0)
})

test('backfill: aborting mid-stream stops delivery cleanly', async () => {
  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: makeFetch(),
  })
  const ac = new AbortController()
  const errored: Error[] = []
  const events = []
  for await (const e of js.snapshot({
    signal: ac.signal,
    onError: (err) => errored.push(err),
    raw: true,
  })) {
    events.push(e)
    ac.abort() // abort right after the first event
  }
  // The first entry's batch flattens fully (3 golden events); the second
  // entry is never delivered.
  expect(events).toHaveLength(3)
  // An abort is a clean stop, not an error.
  expect(errored).toHaveLength(0)
})
