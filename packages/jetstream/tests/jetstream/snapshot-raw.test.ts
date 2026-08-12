import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'

const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

// fetchImpl routes planSnapshot (POST/json) and getBlock (octet-stream).
// Single complete plan page: plannedThroughSeq === sealedTipSeq → terminates.
const fetchImpl = (async (url: string | URL) => {
  const u = String(url)
  if (u.includes('planSnapshot')) {
    return new Response(
      JSON.stringify({
        plannedThroughSeq: 3,
        sealedTipSeq: 3,
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
        ],
        stats: {
          segmentsExamined: 1,
          segmentsMatched: 1,
          blocksMatched: 1,
          entries: 1,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  if (u.includes('getBlock')) return new Response(goldenFrame, { status: 200 })
  throw new Error(`unexpected url ${u}`)
}) as unknown as typeof fetch

test('snapshotRawBatches streams decoded raw events with cursor', async () => {
  const js = new Jetstream({ service: 'https://js.example', fetchImpl })
  const batches = []
  for await (const b of js.snapshotRawBatches({})) batches.push(b)
  expect(batches).toHaveLength(1)
  expect(batches[0].events).toHaveLength(3)
  expect(batches[0].lastCursor).toBe(3)
  expect(batches[0].events[0].kind).toBe('commit')
})

// A plan with one failing entry: getBlock returns HTTP 500.
const fetchOneFailImpl = (async (url: string | URL) => {
  const u = String(url)
  if (u.includes('planSnapshot')) {
    return new Response(
      JSON.stringify({
        plannedThroughSeq: 3,
        sealedTipSeq: 3,
        segments: [
          {
            name: 'fail.jss',
            index: 0,
            checksum: 'x'.repeat(16),
            minSeq: 1,
            maxSeq: 3,
            mode: 'blocks',
            blocks: [{ first: 0, last: 0 }],
          },
        ],
        stats: {
          segmentsExamined: 1,
          segmentsMatched: 1,
          blocksMatched: 1,
          entries: 1,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  // Simulate HTTP 500 for the block download
  return new Response('server error', { status: 500 })
}) as unknown as typeof fetch

test('snapshot: a download that always fails throws after bounded replans (anti-spin)', async () => {
  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: fetchOneFailImpl,
    retry: { maxAttempts: 1 },
  })
  await expect(
    (async () => {
      for await (const _ of js.snapshotRawBatches({ maxRebackfills: 2 })) void _
    })(),
  ).rejects.toThrow(/no progress|re-plan|re-backfill/i)
})

// A plan with TWO entries: first fails, second succeeds.
const fetchFirstFailImpl = (async (url: string | URL) => {
  const u = String(url)
  if (u.includes('planSnapshot')) {
    return new Response(
      JSON.stringify({
        plannedThroughSeq: 6,
        sealedTipSeq: 6,
        segments: [
          {
            name: 'fail.jss',
            index: 0,
            checksum: 'x'.repeat(16),
            minSeq: 1,
            maxSeq: 3,
            mode: 'blocks',
            blocks: [{ first: 0, last: 0 }],
          },
          {
            name: 'ok.jss',
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
  if (u.includes('fail.jss'))
    return new Response('server error', { status: 500 })
  // ok.jss succeeds with the golden frame
  return new Response(goldenFrame, { status: 200 })
}) as unknown as typeof fetch

test('snapshot: does not skip a failing entry to reach a later one (no gap)', async () => {
  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: fetchFirstFailImpl,
    retry: { maxAttempts: 1 },
  })
  await expect(
    (async () => {
      for await (const _ of js.snapshotRawBatches({ maxRebackfills: 3 })) void _
    })(),
  ).rejects.toThrow()
})

// A getBlock that fails once (503) then succeeds — a transient download error
// recovered by re-planning (lastEmitted, tip].
let failOnce = true
const fetchTransientImpl = (async (url: string | URL) => {
  const u = String(url)
  if (u.includes('planSnapshot')) {
    return new Response(
      JSON.stringify({
        plannedThroughSeq: 3,
        sealedTipSeq: 3,
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
        ],
        stats: {
          segmentsExamined: 1,
          segmentsMatched: 1,
          blocksMatched: 1,
          entries: 1,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  if (u.includes('getBlock')) {
    if (failOnce) {
      failOnce = false
      return new Response('err', { status: 503 })
    }
    return new Response(goldenFrame, { status: 200 })
  }
  throw new Error(`unexpected ${u}`)
}) as unknown as typeof fetch

test('snapshot: recovers a transient download failure via replan (no gap, no dup)', async () => {
  failOnce = true
  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: fetchTransientImpl,
    retry: { maxAttempts: 1, baseDelayMs: 1 },
  })
  const seqs: number[] = []
  for await (const b of js.snapshotRawBatches({})) {
    for (const e of b.events) seqs.push(e.seq)
  }
  expect(seqs).toEqual([1, 2, 3]) // golden_block.bin = seq 1,2,3 — delivered once
})

test('snapshot: afterSeq mid-block prunes rows at or below the floor', async () => {
  // The plan is one-sided: a block straddling afterSeq is planned whole, so
  // the client's seq window must drop the already-covered rows.
  const js = new Jetstream({ service: 'https://js.example', fetchImpl })
  const seqs: number[] = []
  for await (const b of js.snapshotRawBatches({ afterSeq: 1 })) {
    for (const e of b.events) seqs.push(e.seq)
  }
  expect(seqs).toEqual([2, 3]) // seq 1 excluded (exclusive lower bound)
})

test('snapshot: beforeSeq mid-block prunes rows above the ceiling', async () => {
  const js = new Jetstream({ service: 'https://js.example', fetchImpl })
  const seqs: number[] = []
  for await (const b of js.snapshotRawBatches({ beforeSeq: 2 })) {
    for (const e of b.events) seqs.push(e.seq)
  }
  expect(seqs).toEqual([1, 2]) // seq 3 excluded (inclusive upper bound)
})

test('snapshot: onError DownloadError names the failed plan entry', async () => {
  failOnce = true
  const errored: Error[] = []
  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: fetchTransientImpl,
    retry: { maxAttempts: 1, baseDelayMs: 1 },
  })
  for await (const _ of js.snapshotRawBatches({
    onError: (err) => errored.push(err),
  }))
    void _
  expect(errored).toHaveLength(1)
  const derr = errored[0] as InstanceType<
    typeof import('../../src/index.js').DownloadError
  >
  expect(derr.name).toBe('DownloadError')
  expect(derr.entry?.name).toBe('a.jss')
})
