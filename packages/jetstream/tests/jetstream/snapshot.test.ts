import { describe, it, expect } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'

describe('Jetstream.snapshot', () => {
  it('resolves resume cursor from the CursorStore (load) when afterSeq absent', async () => {
    let planCalls = 0
    let planAfterSeq: number | undefined = -1
    const fetchImpl = (async (
      url: string | URL,
      init?: Parameters<typeof fetch>[1],
    ) => {
      const u = String(url)
      if (u.includes('planSnapshot')) {
        planCalls++
        // planSnapshot is a POST procedure — afterSeq is in the JSON body
        const body = init?.body != null ? JSON.parse(String(init.body)) : {}
        if (planCalls === 1) {
          // First call: capture afterSeq (resume cursor check); return page 1
          // with plannedThroughSeq < sealedTipSeq so planPages continues.
          planAfterSeq =
            body.afterSeq !== undefined ? Number(body.afterSeq) : undefined
          return new Response(
            JSON.stringify({
              plannedThroughSeq: 50,
              sealedTipSeq: 100,
              segments: [],
              stats: {
                segmentsExamined: 0,
                segmentsMatched: 0,
                blocksMatched: 0,
                entries: 0,
              },
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        // Second call: page 2 — plannedThroughSeq === sealedTipSeq → done.
        return new Response(
          JSON.stringify({
            plannedThroughSeq: 100,
            sealedTipSeq: 100,
            segments: [],
            stats: {
              segmentsExamined: 0,
              segmentsMatched: 0,
              blocksMatched: 0,
              entries: 0,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }
      return new Response('nf', { status: 404 })
    }) as unknown as typeof fetch

    const store = new MemoryCursorStore()
    await store.save(42)
    const js = new Jetstream({ service: 'https://js.example', fetchImpl })
    const out: unknown[] = []
    for await (const evt of js.snapshot({ cursor: store })) {
      out.push(evt)
    }
    expect(out).toEqual([])
    expect(planAfterSeq).toBe(42)
    expect(planCalls).toBe(2) // paged through to the sealed tip
  })
})
