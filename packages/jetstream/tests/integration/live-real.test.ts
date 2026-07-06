import { expect, test } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'

const HOST = process.env.JETSTREAM_LIVE_HOST // e.g. https://jetstream1.us-east.bsky.network
const maybe = HOST ? test : test.skip

maybe(
  'live() decodes real frames from a running jetstream',
  async () => {
    const js = new Jetstream({ service: HOST! })
    const ac = new AbortController()
    const src = js.live({
      collections: ['app.bsky.feed.post'],
      signal: ac.signal,
    })
    const seen: string[] = []
    const run = (async () => {
      for await (const e of src) {
        if (e.kind === 'commit' && e.commit.operation !== 'delete') {
          expect(e.commit.cid).toMatch(/^bafy/)
          seen.push(e.commit.collection)
        }
        if (seen.length >= 5) break
      }
    })()
    const timeout = new Promise<void>((r) =>
      setTimeout(() => {
        ac.abort()
        r()
      }, 15000),
    )
    await Promise.race([run, timeout])
    ac.abort()
    expect(seen.length).toBeGreaterThan(0)
  },
  20000,
)
