// Runs with `#runtime` resolved to the browser branch
// (vitest.browser.config.ts), mirroring what a browser bundler selects.
import { describe, expect, it } from 'vitest'
import { defaultDecompressor, defaultSha256 } from '#runtime'
import { Jetstream } from '../../src/index.js'
import {
  defaultDecompressor as nodeDefaultDecompressor,
  defaultSha256 as nodeDefaultSha256,
} from '../../src/runtime/node.js'

describe('browser runtime shims', () => {
  it('throw with a supply-your-own message when called', () => {
    expect(() => defaultDecompressor()).toThrow(
      /supply your own Decompressor via Jetstream options/,
    )
    expect(() => defaultSha256()).toThrow(
      /supply your own via Jetstream options/,
    )
  })

  it('snapshot() without injected implementations fails at first pull, before any network work', async () => {
    const fetchImpl = (async () => {
      throw new Error('network must not be touched')
    }) as unknown as typeof fetch
    const js = new Jetstream({ service: 'https://js.example', fetchImpl })
    const gen = js.snapshot()
    await expect(gen.next()).rejects.toThrow(/supply your own/)
  })

  it('replay() without injected implementations fails the same way', async () => {
    const fetchImpl = (async () => {
      throw new Error('network must not be touched')
    }) as unknown as typeof fetch
    const js = new Jetstream({ service: 'https://js.example', fetchImpl })
    const gen = js.replay()
    await expect(gen.next()).rejects.toThrow(/supply your own/)
  })

  it('snapshot() works with injected implementations (the browser escape hatch)', async () => {
    // Injecting the node implementations stands in for a real browser zstd/
    // sha256 — what matters is that injection bypasses the shims entirely.
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes('planSnapshot')) {
        return new Response(
          JSON.stringify({
            plannedThroughSeq: 0,
            sealedTipSeq: 0,
            segments: [],
            stats: {
              segmentsExamined: 0,
              segmentsMatched: 0,
              blocksMatched: 0,
              entries: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error('unexpected')
    }) as unknown as typeof fetch
    const js = new Jetstream({
      service: 'https://js.example',
      fetchImpl,
      decompressor: nodeDefaultDecompressor(),
      sha256: nodeDefaultSha256(),
    })
    const events = []
    for await (const e of js.snapshot()) events.push(e)
    expect(events).toEqual([]) // empty archive: completed without touching shims
  })
})
