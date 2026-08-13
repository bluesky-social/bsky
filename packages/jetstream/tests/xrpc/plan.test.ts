import { type DidString } from '@atproto/lex'
import { expect, test } from 'vitest'
import { planSnapshot } from '../../src/xrpc/plan.js'

function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

const EMPTY_PLAN = {
  plannedThroughSeq: 0,
  sealedTipSeq: 0,
  segments: [],
  stats: {
    segmentsExamined: 0,
    segmentsMatched: 0,
    blocksMatched: 0,
    entries: 0,
  },
}

// Captures the JSON request bodies so the sent filter axes can be asserted.
function capturingFetch(): {
  fetch: typeof fetch
  bodies: Record<string, unknown>[]
} {
  const bodies: Record<string, unknown>[] = []
  const impl = (async (
    _url: string | URL,
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => {
    bodies.push(init?.body != null ? JSON.parse(String(init.body)) : {})
    return new Response(JSON.stringify(EMPTY_PLAN), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch: impl, bodies }
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

test('sends the kinds filter so the server prunes the plan', async () => {
  const { fetch, bodies } = capturingFetch()
  await planSnapshot(
    {
      host: 'https://js.example',
      kinds: ['commit', 'identity'],
      dids: ['did:plc:a' as DidString],
      collections: ['app.bsky.feed.post'],
      afterSeq: 5,
    },
    fetch,
  )
  expect(bodies[0]).toEqual({
    kinds: ['commit', 'identity'],
    dids: ['did:plc:a'],
    collections: ['app.bsky.feed.post'],
    afterSeq: 5,
  })
})

test('omits empty filter axes — an empty array is match-all, but so is absence', async () => {
  // Sending kinds: [] would be accepted, but omission keeps the request
  // minimal and the wire honest about "no filter was expressed".
  const { fetch, bodies } = capturingFetch()
  await planSnapshot(
    { host: 'https://js.example', kinds: [], dids: [], collections: [] },
    fetch,
  )
  expect(bodies[0]).toEqual({})
})

test('rejects filter lists the server would refuse with InvalidRequest', async () => {
  const { fetch } = capturingFetch()
  await expect(
    planSnapshot(
      {
        host: 'https://js.example',
        kinds: ['commit', 'commit', 'commit', 'commit', 'commit'],
      },
      fetch,
    ),
  ).rejects.toThrow(RangeError)
  await expect(
    planSnapshot(
      {
        host: 'https://js.example',
        dids: Array.from(
          { length: 10_001 },
          (_, i) => `did:plc:${i}` as DidString,
        ),
      },
      fetch,
    ),
  ).rejects.toThrow(RangeError)
  await expect(
    planSnapshot(
      {
        host: 'https://js.example',
        collections: Array.from({ length: 101 }, (_, i) => `app.test.c${i}`),
      },
      fetch,
    ),
  ).rejects.toThrow(RangeError)
})

test('rejects a collections filter that can never apply (kinds excludes commit)', async () => {
  const { fetch, bodies } = capturingFetch()
  await expect(
    planSnapshot(
      {
        host: 'https://js.example',
        kinds: ['identity'],
        collections: ['app.bsky.feed.post'],
      },
      fetch,
    ),
  ).rejects.toThrow(/can never apply/)
  expect(bodies).toEqual([]) // rejected before any request went out
})
