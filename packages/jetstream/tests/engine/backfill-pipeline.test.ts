import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { backfillBatches } from '../../src/engine/backfill-pipeline.js'
import { makeSelector } from '../../src/engine/selector.js'
import { defaultRuntime } from '../../src/runtime/node.js'
import type { PlanEntry } from '../../src/xrpc/plan.js'

const decompressor = defaultRuntime.zstdDecompressor()
const sha256 = defaultRuntime.sha256()

// golden_block.bin = 3 sealed rows: seq 1 (post create), 2 (identity), 3 (like delete).
const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

// getBlock returns the raw frame; this fake serves the golden frame for any block.
const fetchImpl = (async (url: string | URL) => {
  if (String(url).includes('getBlock'))
    return new Response(goldenFrame, { status: 200 })
  throw new Error(`unexpected ${String(url)}`)
}) as unknown as typeof fetch

const entry = (name: string, count: number): PlanEntry =>
  ({
    name,
    index: 0,
    checksum: 'x'.repeat(16),
    minSeq: 0,
    maxSeq: 3,
    mode: 'blocks',
    blocks: [{ first: 0, last: count - 1 }],
  }) as unknown as PlanEntry

async function collect<T>(src: AsyncIterable<T>) {
  const o: T[] = []
  for await (const x of src) o.push(x)
  return o
}

describe('backfillBatches (streaming, per-block)', () => {
  it('emits one batch per block (2-block entry yields 2 batches)', async () => {
    const selector = makeSelector({ collections: [] }) // no filter: all 3 events per block
    const batches = await collect(
      backfillBatches({
        host: 'https://h',
        entries: [entry('a.jss', 2)],
        selector,
        fetchImpl,
        decompressor,
        sha256,
      }),
    )
    // Per-block emit: 2 blocks -> 2 batches (not 1 per entry)
    expect(batches.length).toBe(2)
    // Each golden block has 3 events
    for (const b of batches) {
      expect(b.events.length).toBe(3)
      expect(b.lastCursor).toBe(3) // max seq in golden block is 3
    }
  })

  it('selector filters events within each batch', async () => {
    // Filter to posts only: post (seq 1) + identity bypasses the filter
    // (seq 2) -> 2 per block; like delete (seq 3) is filtered out.
    const selector = makeSelector({ collections: ['app.bsky.feed.post'] })
    const batches = await collect(
      backfillBatches({
        host: 'https://h',
        entries: [entry('a.jss', 1)],
        selector,
        fetchImpl,
        decompressor,
        sha256,
      }),
    )
    expect(batches.length).toBe(1)
    // post + identity = 2 events (like is filtered by collection)
    expect(batches[0].events.length).toBe(2)
  })

  it('yields events in ascending seq order within a batch', async () => {
    const selector = makeSelector({ collections: [] })
    const batches = await collect(
      backfillBatches({
        host: 'https://h',
        entries: [entry('a.jss', 1)],
        selector,
        fetchImpl,
        decompressor,
        sha256,
      }),
    )
    expect(batches.length).toBe(1)
    const seqs = batches[0].events.map((e) => e.seq)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThanOrEqual(seqs[i - 1])
    }
  })

  it('skips a batch with zero kept events (did filter matches nothing)', async () => {
    const selector = makeSelector({
      dids: ['did:plc:nobody'],
      collections: [],
    })
    const batches = await collect(
      backfillBatches({
        host: 'https://h',
        entries: [entry('a.jss', 2)],
        selector,
        fetchImpl,
        decompressor,
        sha256,
      }),
    )
    expect(batches).toEqual([])
  })

  it('forwards blockConcurrency to the block scheduler', async () => {
    let maxBlockConcurrent = 0
    const inflight: string[] = []
    const spyFetch = (async (url: string | URL) => {
      const u = String(url)
      if (!u.includes('getBlock')) throw new Error(`unexpected ${u}`)
      inflight.push('block')
      maxBlockConcurrent = Math.max(maxBlockConcurrent, inflight.length)
      await new Promise((r) => setTimeout(r, 5))
      inflight.pop()
      return new Response(goldenFrame, { status: 200 })
    }) as unknown as typeof fetch
    const selector = makeSelector({ collections: ['app.bsky.feed.post'] })
    await collect(
      backfillBatches({
        host: 'https://h',
        entries: [entry('a.jss', 6)],
        selector,
        fetchImpl: spyFetch,
        decompressor,
        sha256,
        blockConcurrency: 3,
      }),
    )
    expect(maxBlockConcurrent).toBe(3)
  })

  it('throws on a decode failure (no continue-past)', async () => {
    const flakyFetch = (async (url: string | URL) => {
      if (String(url).includes('getBlock')) {
        const idx = Number(
          new URL(String(url)).searchParams.get('blockIndex') ?? '0',
        )
        if (idx === 0) return new Response(new Uint8Array(4), { status: 200 })
        return new Response(goldenFrame, { status: 200 })
      }
      throw new Error(`unexpected ${String(url)}`)
    }) as unknown as typeof fetch
    const selector = makeSelector({ collections: [] })
    await expect(
      collect(
        backfillBatches({
          host: 'https://h',
          entries: [entry('a.jss', 3)],
          selector,
          fetchImpl: flakyFetch,
          decompressor,
          sha256,
        }),
      ),
    ).rejects.toThrow()
  })
})
