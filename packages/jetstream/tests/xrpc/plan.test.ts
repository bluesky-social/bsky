import { expect, test } from 'vitest'
import { planSnapshot } from '../../src/xrpc/plan.js'

function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

test('parses a plan response into typed entries', async () => {
  const f = jsonFetch({
    plannedThroughSeq: 500,
    sealedTipSeq: 600,
    segments: [
      {
        name: 'seg_00.jss',
        index: 0,
        checksum: '0123456789abcdef',
        minSeq: 1,
        maxSeq: 100,
        mode: 'segment',
      },
      {
        name: 'seg_01.jss',
        index: 1,
        checksum: 'fedcba9876543210',
        minSeq: 101,
        maxSeq: 200,
        mode: 'blocks',
        blocks: [{ first: 2, last: 4 }],
      },
    ],
    stats: {
      segmentsExamined: 2,
      segmentsMatched: 2,
      blocksMatched: 3,
      entries: 2,
    },
  })
  const plan = await planSnapshot(
    { host: 'https://js.example', collections: ['app.bsky.feed.post'] },
    f,
  )
  expect(plan.plannedThroughSeq).toBe(500)
  expect(plan.sealedTipSeq).toBe(600)
  expect(plan.segments).toHaveLength(2)
  expect(plan.segments[1].mode).toBe('blocks')
  expect(plan.segments[1].blocks).toEqual([{ first: 2, last: 4 }])
})
