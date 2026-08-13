import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SocketError } from '@atproto/ws-client'
import { expect, test } from 'vitest'
import {
  type CutoverParams,
  cutoverReplay as cutoverReplayBase,
} from '../../src/live/cutover.js'
import type { LiveTransport } from '../../src/live/transport.js'
import { defaultRuntime } from '../../src/runtime/node.js'

// The class layer resolves these platform defaults; supply them here since
// cutoverReplay takes them as required params.
const decompressor = defaultRuntime.zstdDecompressor()
const sha256 = defaultRuntime.sha256()
const cutoverReplay = (ctx: Omit<CutoverParams, 'decompressor' | 'sha256'>) =>
  cutoverReplayBase({ ...ctx, decompressor, sha256 })

// golden_block.bin = 3 sealed rows: seq 1 (post create), 2 (identity),
// 3 (app.bsky.feed.like DELETE).
const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

const NSID = 'network.bsky.jetstream.subscribeEvents'

// One shipped-wire commit message frame: record + cid only, no recordCbor
// (upstream removed it — jetstream cd7a696).
const liveCommit = (seq: number) =>
  JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#commit`,
      seq,
      did: 'did:plc:a',
      time: '2024-09-09T19:46:02.329308Z',
      rev: 'r',
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: `k${seq}`,
      cid: 'bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi',
      record: { $type: 'app.bsky.feed.post', text: String(seq) },
    },
  })

const SEALED_ENTRY = {
  name: 'a.jss',
  index: 0,
  checksum: 'x'.repeat(16),
  minSeq: 1,
  maxSeq: 3,
  mode: 'blocks',
  blocks: [{ first: 0, last: 0 }],
}

// Scripted planSnapshot fetch: serves the given plan pages in order, answers
// getBlock downloads with the golden frame.
function makeFetch(pages: Array<Record<string, unknown>>): typeof fetch {
  let planCall = 0
  return (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('planSnapshot')) {
      const page = pages[Math.min(planCall, pages.length - 1)]
      planCall++
      return new Response(
        JSON.stringify({
          plannedThroughSeq: 0,
          sealedTipSeq: 0,
          segments: [],
          stats: {
            segmentsExamined: 1,
            segmentsMatched: 1,
            blocksMatched: 1,
            entries: 0,
          },
          ...page,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (u.includes('getBlock'))
      return new Response(goldenFrame, { status: 200 })
    throw new Error(`unexpected ${u}`)
  }) as unknown as typeof fetch
}

// Live transport that yields frames once then ends. Captures the subscribe URL.
function liveTransport(
  frames: string[],
  onUrl?: (url: string) => void,
): LiveTransport {
  return {
    async *stream(getUrl) {
      onUrl?.(typeof getUrl === 'function' ? getUrl() : String(getUrl))
      for (const f of frames) yield new TextEncoder().encode(f)
    },
  }
}

// Transport that THROWS "cursor too old" on the first connect, then on the
// second connect yields the given frames. Models the slow-handoff 400.
function tooOldOnceTransport(frames: string[]): LiveTransport {
  let connects = 0
  return {
    async *stream(getUrl) {
      const url = typeof getUrl === 'function' ? getUrl() : String(getUrl)
      connects++
      if (connects === 1) {
        throw new Error(`XRPCError 400: subscribe: cursor too old (url=${url})`)
      }
      for (const f of frames) yield new TextEncoder().encode(f)
    },
  }
}

async function drain(src: AsyncGenerator<{ events: { seq: number }[] }>) {
  const seqs: number[] = []
  for await (const b of src) for (const e of b.events) seqs.push(e.seq)
  return seqs
}

test('cutoverReplay: backfill across TWO pages (<=tip) then live (>tip), no gap no dup', async () => {
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post', 'app.bsky.feed.like'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
        { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
      ]),
      transport: liveTransport([
        liveCommit(2),
        liveCommit(3),
        liveCommit(4),
        liveCommit(5),
      ]),
    }),
  )
  // backfill 1,2,3 (incl. like DELETE at 3); live overlap 2,3 (<=tip) dropped; 4,5 delivered.
  expect(seqs).toEqual([1, 2, 3, 4, 5])
})

test('cutoverReplay: connects live at cursor = sealedTip (no rewind margin)', async () => {
  const tip = 1000
  let liveUrl: string | undefined
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 300, sealedTipSeq: tip, segments: [] },
        { plannedThroughSeq: tip, sealedTipSeq: tip, segments: [] },
      ]),
      transport: liveTransport(
        [liveCommit(900), liveCommit(1001), liveCommit(1002)],
        (url) => {
          liveUrl = url
        },
      ),
    }),
  )
  // No margin: cursor is the pinned tip exactly. Overlap <=tip (900) dropped; >tip kept.
  expect(new URL(liveUrl!).searchParams.get('cursor')).toBe(String(tip))
  expect(seqs).toEqual([1001, 1002])
})

test('cutoverReplay: a backfilled DELETE is delivered as an ordinary event', async () => {
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.like'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
        { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
      ]),
      transport: liveTransport([]), // isolate backfill
    }),
  )
  // seq 2 (identity, bypasses collection filter) + seq 3 (like DELETE) delivered;
  // seq 1 (post create) filtered out by the like-only filter.
  expect(seqs).toEqual([2, 3])
})

test('cutoverReplay: kinds reaches both phases — the plan body and the live wire', async () => {
  const planBodies: Record<string, unknown>[] = []
  const base = makeFetch([
    { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
  ])
  const fetchImpl = (async (
    url: string | URL,
    init?: Parameters<typeof fetch>[1],
  ) => {
    if (String(url).includes('planSnapshot')) {
      planBodies.push(init?.body != null ? JSON.parse(String(init.body)) : {})
    }
    return base(url, init)
  }) as unknown as typeof fetch

  let liveUrl: string | undefined
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post', 'app.bsky.feed.like'],
      kinds: ['commit'],
      fetchImpl,
      transport: liveTransport([liveCommit(4)], (url) => {
        liveUrl = url
      }),
    }),
  )
  expect(planBodies[0].kinds).toEqual(['commit'])
  expect(new URL(liveUrl!).searchParams.getAll('kinds')).toEqual(['commit'])
  // Backfill 1 and 3 (commits); 2 (identity) pruned client-side despite the
  // one-sided plan shipping it. Live 4 delivered.
  expect(seqs).toEqual([1, 3, 4])
})

test('cutoverReplay: empty archive (tip 0) — live owns the whole stream from the first seq', async () => {
  // v2 wire seq must be >= 1 (decodeLiveFrame rejects seq <= 0), so this
  // exercises the undefined-dedupFloor path at seq 1 rather than seq 0.
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 0, sealedTipSeq: 0, segments: [] },
      ]),
      transport: liveTransport([liveCommit(1), liveCommit(2), liveCommit(3)]),
    }),
  )
  expect(seqs).toEqual([1, 2, 3]) // nothing dropped at the empty-archive cutover
})

test('cutoverReplay: kinds filter prunes archive backfill client-side; lastCursor still reaches the archive tip', async () => {
  // golden_block.bin: seq 1 = commit (post create), seq 2 = identity, seq 3 =
  // commit (like delete). kinds: ['commit'] must prune the identity from the
  // BACKFILL phase too (not just the live tail), while the watermark still
  // advances through the pruned seq — same precedent as shape()'s
  // skip-invalid-keep-lastCursor behavior.
  const batches: {
    events: { seq: number; kind: string }[]
    lastCursor: number
  }[] = []
  for await (const b of cutoverReplay({
    host: 'https://h',
    nsids: ['app.bsky.feed.post', 'app.bsky.feed.like'],
    kinds: ['commit'],
    fetchImpl: makeFetch([
      { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
      { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
    ]),
    transport: liveTransport([]), // isolate backfill
  })) {
    batches.push(b)
  }
  const allSeqs = batches.flatMap((b) => b.events.map((e) => e.seq))
  expect(allSeqs).toEqual([1, 3]) // identity (seq 2) pruned from the backfill phase
  const lastCursors = batches.map((b) => b.lastCursor)
  expect(Math.max(...lastCursors)).toBe(3) // watermark still reaches the archive tip
})

test('cutoverReplay: an empty-after-filter batch still yields (lastCursor preserved)', async () => {
  // A backfill entry that is ENTIRELY the identity event (seq 2 only) becomes
  // an empty events array under kinds: ['commit'], but must still yield so
  // the watermark advances.
  const batches: { events: unknown[]; lastCursor: number }[] = []
  for await (const b of cutoverReplay({
    host: 'https://h',
    // No collections filter: pairing one with a kinds list that excludes
    // 'commit' is unsatisfiable and rejected (see assertWireFilters).
    nsids: [],
    kinds: ['identity'], // inverse: keep ONLY the identity, drop both commits
    fetchImpl: makeFetch([
      { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
      { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
    ]),
    transport: liveTransport([]),
  })) {
    batches.push(b)
  }
  expect(batches.length).toBeGreaterThan(0)
  const allSeqs = batches.flatMap((b) =>
    (b.events as { seq: number }[]).map((e) => e.seq),
  )
  expect(allSeqs).toEqual([2])
  expect(Math.max(...batches.map((b) => b.lastCursor))).toBe(3)
})

test('cutoverReplay: without kinds, backfill delivers every kind (unchanged behavior)', async () => {
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post', 'app.bsky.feed.like'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
        { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
      ]),
      transport: liveTransport([]),
    }),
  )
  expect(seqs).toEqual([1, 2, 3]) // identity (seq 2) flows through with no kinds filter
})

test('cutoverReplay: too-old at connect re-backfills and reconnects (recovery)', async () => {
  // First connect throws "cursor too old"; cutoverReplay re-sweeps and reconnects,
  // the second connect yields live events. Backfill is empty (tip 3) both sweeps.
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
      ]),
      transport: tooOldOnceTransport([liveCommit(4), liveCommit(5)]),
    }),
  )
  // No backfill rows; after recovery the second connect delivers live 4,5.
  expect(seqs).toEqual([4, 5])
})

test('cutoverReplay: too-old that cannot advance is fatal (anti-spin)', async () => {
  // Every connect throws too-old and the tail delivers nothing, so resume can
  // never advance past cutover -> fatal after the bound.
  const alwaysTooOld: LiveTransport = {
    // eslint-disable-next-line require-yield -- every connect throws
    async *stream() {
      throw new Error('XRPCError 400: subscribe: cursor too old')
    },
  }
  await expect(
    drain(
      cutoverReplay({
        host: 'https://h',
        nsids: ['app.bsky.feed.post'],
        maxReplans: 2,
        fetchImpl: makeFetch([
          { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
        ]),
        transport: alwaysTooOld,
      }),
    ),
  ).rejects.toThrow(/no progress|re-backfill/)
})

test('cutoverReplay: pre-aborted signal is a no-op stream', async () => {
  const ac = new AbortController()
  ac.abort()
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post'],
      signal: ac.signal,
      fetchImpl: makeFetch([
        { plannedThroughSeq: 0, sealedTipSeq: 0, segments: [] },
      ]),
      transport: liveTransport([liveCommit(1)]),
    }),
  )
  expect(seqs).toEqual([])
})

test('cutoverReplay: deliver-then-too-old triggers recovery (lastDelivered > cutover branch)', async () => {
  // Connect#1: yields seq 4,5 then throws cursor-too-old.
  // cutoverReplay catches it, sets resume = max(lastDelivered=5, cutover=0) = 5.
  // Re-backfills from 5 (empty archive both sweeps), reconnects at cutover=5.
  // Connect#2: yields seq 6. Full delivered sequence must be [4,5,6].
  let connects = 0
  const transport: LiveTransport = {
    async *stream() {
      connects++
      if (connects === 1) {
        yield new TextEncoder().encode(liveCommit(4))
        yield new TextEncoder().encode(liveCommit(5))
        throw new Error('XRPCError 400: subscribe: cursor too old')
      }
      // connect #2: deliver 6, then end cleanly
      yield new TextEncoder().encode(liveCommit(6))
    },
  }
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post'],
      fetchImpl: makeFetch([
        // empty archive, tip 0 — both the initial sweep and the re-backfill sweep
        { plannedThroughSeq: 0, sealedTipSeq: 0, segments: [] },
      ]),
      transport,
    }),
  )
  expect(seqs).toEqual([4, 5, 6])
})

test('cutoverReplay: a transient backfill download error is not a gap', async () => {
  // blocks-mode entry whose getBlock fails once (503) then succeeds.
  let failOnce = true
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
    if (u.includes('getBlock')) {
      if (failOnce) {
        failOnce = false
        return new Response('err', { status: 503 })
      }
      return new Response(goldenFrame, { status: 200 })
    }
    throw new Error(`unexpected ${u}`)
  }) as unknown as typeof fetch

  const batches = []
  for await (const b of cutoverReplay({
    host: 'https://h',
    nsids: [],
    fetchImpl,
    transport: liveTransport([]),
    retry: { maxAttempts: 1 },
  })) {
    batches.push(b)
  }
  // The 503-once did not gap or fatal: backfilled events were delivered.
  const seqs = batches.flatMap((b) => b.events.map((e) => e.seq))
  expect(seqs.length).toBeGreaterThan(0)
})

test('cutoverReplay: mid-stream abort stops cleanly, delivers pre-abort events', async () => {
  // Transport yields seq 7 immediately, then suspends until signal aborts,
  // then RETURNS cleanly (no throw) — matching the LiveTransport contract.
  // Live events flow as single-event batches, so the first event yields a
  // batch immediately and the caller can abort without blocking on stream end.
  const ac = new AbortController()
  const transport: LiveTransport = {
    async *stream(_getUrl, signal) {
      yield new TextEncoder().encode(liveCommit(7))
      // Block until externally aborted; resolve (not reject) so the generator
      // returns cleanly, matching the transport contract (abort → clean end).
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    },
  }
  const seqs: number[] = []
  const gen = cutoverReplay({
    host: 'https://h',
    nsids: ['app.bsky.feed.post'],
    signal: ac.signal,
    fetchImpl: makeFetch([
      { plannedThroughSeq: 0, sealedTipSeq: 0, segments: [] },
    ]),
    transport,
  })
  // Collect the first batch (seq 7), then abort.
  const first = await gen.next()
  if (!first.done) for (const e of first.value.events) seqs.push(e.seq)
  ac.abort()
  // Drain remainder — should end cleanly (no throw).
  for await (const b of gen) for (const e of b.events) seqs.push(e.seq)
  expect(seqs).toEqual([7])
})

test('cutoverReplay: raw replay yields CBOR-arm records from backfill and JSON-arm from the tail', async () => {
  // The backfill phase decodes golden_block.bin (seq 1 post CREATE, wire-
  // faithful CBOR bytes as `record`); the live tail decodes liveCommit(4)
  // (wire-faithful parsed JSON as `record`). Both phases feed the SAME
  // generator, so this pins the per-arm shape the generic RawPutCommit<T>
  // narrowing exists to describe: backfill is always the CBOR arm, the live
  // tail is always the JSON arm — `record instanceof Uint8Array` discriminates.
  const kinds: Array<'cbor' | 'json'> = []
  for await (const batch of cutoverReplay({
    host: 'https://h',
    nsids: ['app.bsky.feed.post', 'app.bsky.feed.like'],
    fetchImpl: makeFetch([
      { plannedThroughSeq: 2, sealedTipSeq: 3, segments: [SEALED_ENTRY] },
      { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
    ]),
    transport: liveTransport([liveCommit(4)]),
  })) {
    for (const ev of batch.events) {
      if (ev.kind !== 'commit' || ev.commit.operation === 'delete') continue
      kinds.push(ev.commit.record instanceof Uint8Array ? 'cbor' : 'json')
    }
  }
  expect(kinds).toEqual(['cbor', 'json']) // seam is typed, not hidden
})

test('cutoverReplay: a bare 400 handshake rejection (body unreadable) is treated as cursor-too-old', async () => {
  // The default ws transport discards the 400 body, so the "cursor too old"
  // marker is unreadable — only the status survives. Recovery must still
  // trigger off the handshake status.
  let connects = 0
  const transport: LiveTransport = {
    async *stream() {
      connects++
      if (connects === 1) {
        // Shape matches ws-client's surfaced handshake rejection: the raw ws
        // error wrapped in a SocketError.
        throw new SocketError(new Error('Unexpected server response: 400'))
      }
      yield new TextEncoder().encode(liveCommit(4))
    },
  }
  const seqs = await drain(
    cutoverReplay({
      host: 'https://h',
      nsids: ['app.bsky.feed.post'],
      fetchImpl: makeFetch([
        { plannedThroughSeq: 3, sealedTipSeq: 3, segments: [] },
      ]),
      transport,
    }),
  )
  expect(seqs).toEqual([4])
  expect(connects).toBe(2)
})
