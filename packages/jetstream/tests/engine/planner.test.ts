import { describe, expect, it } from 'vitest'
import { planPages } from '../../src/engine/planner.js'
import type { Plan } from '../../src/xrpc/plan.js'

// Build a fake fetch that serves a scripted sequence of planSnapshot pages.
// Each call returns the next page; we capture the request bodies to assert
// the afterSeq/beforeSeq pagination wiring.
function fakePlanFetch(pages: Array<Partial<Plan>>): {
  fetch: typeof fetch
  bodies: Array<{ afterSeq?: number; beforeSeq?: number; kinds?: string[] }>
} {
  const bodies: Array<{
    afterSeq?: number
    beforeSeq?: number
    kinds?: string[]
  }> = []
  let i = 0
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body =
      (init as RequestInit | undefined)?.body != null
        ? JSON.parse(String((init as RequestInit).body))
        : {}
    bodies.push({
      afterSeq: body.afterSeq,
      beforeSeq: body.beforeSeq,
      kinds: body.kinds,
    })
    const page = pages[Math.min(i, pages.length - 1)]
    i++
    const full = {
      plannedThroughSeq: 0,
      sealedTipSeq: 0,
      segments: [],
      stats: {
        segmentsExamined: 0,
        segmentsMatched: 0,
        blocksMatched: 0,
        entries: 0,
      },
      ...page,
    }
    return new Response(JSON.stringify(full), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch, bodies }
}

async function collect<T>(src: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of src) out.push(x)
  return out
}

describe('planPages', () => {
  it('empty archive (sealedTipSeq 0) yields exactly one page and stops', async () => {
    const { fetch, bodies } = fakePlanFetch([
      { plannedThroughSeq: 0, sealedTipSeq: 0 },
    ])
    const pages = await collect(
      planPages({ host: 'https://h', collections: [], fetchImpl: fetch }),
    )
    expect(pages).toHaveLength(1)
    expect(bodies).toHaveLength(1)
  })

  it('single page (plannedThroughSeq === sealedTipSeq) yields one page', async () => {
    const { fetch } = fakePlanFetch([
      { plannedThroughSeq: 100, sealedTipSeq: 100 },
    ])
    const pages = await collect(
      planPages({ host: 'https://h', collections: [], fetchImpl: fetch }),
    )
    expect(pages).toHaveLength(1)
    expect(pages[0].sealedTipSeq).toBe(100)
  })

  it('multi-page: pins sealedTipSeq and pages afterSeq=plannedThroughSeq with beforeSeq pinned', async () => {
    const { fetch, bodies } = fakePlanFetch([
      { plannedThroughSeq: 50, sealedTipSeq: 100 }, // page 1: not done
      { plannedThroughSeq: 100, sealedTipSeq: 100 }, // page 2: done
    ])
    const pages = await collect(
      planPages({
        host: 'https://h',
        collections: [],
        afterSeq: 10,
        fetchImpl: fetch,
      }),
    )
    expect(pages).toHaveLength(2)
    // page 1 starts at the caller's afterSeq, no beforeSeq pin yet
    expect(bodies[0].afterSeq).toBe(10)
    expect(bodies[0].beforeSeq).toBeUndefined()
    // page 2 continues at plannedThroughSeq and pins beforeSeq to the tip
    expect(bodies[1].afterSeq).toBe(50)
    expect(bodies[1].beforeSeq).toBe(100)
  })

  it('resume exactly at the tip yields one page and terminates', async () => {
    const { fetch, bodies } = fakePlanFetch([
      { plannedThroughSeq: 100, sealedTipSeq: 100 },
    ])
    const pages = await collect(
      planPages({
        host: 'https://h',
        collections: [],
        afterSeq: 100,
        fetchImpl: fetch,
      }),
    )
    expect(pages).toHaveLength(1)
    expect(bodies).toHaveLength(1)
  })

  it('caller-provided beforeSeq is forwarded on page 1, replaced by pinned tip on page 2', async () => {
    const { fetch, bodies } = fakePlanFetch([
      { plannedThroughSeq: 50, sealedTipSeq: 100 },
      { plannedThroughSeq: 100, sealedTipSeq: 100 },
    ])
    await collect(
      planPages({
        host: 'https://h',
        collections: [],
        beforeSeq: 250,
        fetchImpl: fetch,
      }),
    )
    expect(bodies[0].beforeSeq).toBe(250)
    expect(bodies[1].beforeSeq).toBe(100)
  })

  it('forwards the kinds filter on every page', async () => {
    const { fetch, bodies } = fakePlanFetch([
      { plannedThroughSeq: 50, sealedTipSeq: 100 },
      { plannedThroughSeq: 100, sealedTipSeq: 100 },
    ])
    await collect(
      planPages({
        host: 'https://h',
        collections: [],
        kinds: ['commit'],
        fetchImpl: fetch,
      }),
    )
    expect(bodies.map((b) => b.kinds)).toEqual([['commit'], ['commit']])
  })

  it('omits kinds when unset, keeping the marker-safe planner default', async () => {
    // With kinds omitted the server admits the $account/$identity/$sync
    // sentinel blocks under a collection filter, so a collection-filtered
    // snapshot still receives the DID-level markers it must fold.
    const { fetch, bodies } = fakePlanFetch([
      { plannedThroughSeq: 100, sealedTipSeq: 100 },
    ])
    await collect(
      planPages({
        host: 'https://h',
        collections: ['app.bsky.feed.post'],
        fetchImpl: fetch,
      }),
    )
    expect(bodies[0].kinds).toBeUndefined()
  })

  it('throws fatally if the cursor fails to advance (anti-spin)', async () => {
    // plannedThroughSeq (40) <= prev afterSeq (40) while tip stays higher
    const { fetch } = fakePlanFetch([
      { plannedThroughSeq: 40, sealedTipSeq: 100 },
      { plannedThroughSeq: 40, sealedTipSeq: 100 },
    ])
    await expect(
      collect(
        planPages({
          host: 'https://h',
          collections: [],
          afterSeq: 40,
          fetchImpl: fetch,
        }),
      ),
    ).rejects.toThrow(/no progress/)
  })
})

it('caps the pinned tip at the caller beforeSeq even if the server ignores it', async () => {
  // A conforming server already returns sealedTipSeq capped by beforeSeq
  // (planSnapshot lexicon); this pins the client-side belt-and-braces so a
  // non-conforming server cannot make us page (and download) past the bound.
  const { fetch, bodies } = fakePlanFetch([
    { plannedThroughSeq: 50, sealedTipSeq: 1000 }, // tip NOT capped by server
    { plannedThroughSeq: 100, sealedTipSeq: 1000 },
  ])
  const pages = await collect(
    planPages({
      host: 'https://h',
      collections: [],
      beforeSeq: 100,
      fetchImpl: fetch,
    }),
  )
  // stops at the caller's bound, not the server's runaway tip
  expect(pages).toHaveLength(2)
  expect(bodies[1].beforeSeq).toBe(100)
})
