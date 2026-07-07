import { expect, test } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'

const HOST = process.env.JETSTREAM_LIVE_HOST // e.g. https://jetstream1.us-east.bsky.network
const maybe = HOST ? test : test.skip

maybe(
  'live() decodes real frames from a running jetstream',
  async () => {
    const js = new Jetstream({ service: HOST! })
    const signal = AbortSignal.timeout(15000)
    const seen: string[] = []
    for await (const e of js.live({
      collections: ['app.bsky.feed.post'],
      signal,
    })) {
      if (e.kind === 'commit' && e.commit.operation !== 'delete') {
        expect(e.commit.cid).toMatch(/^bafy/)
        seen.push(e.commit.collection)
      }
      if (seen.length >= 5) break
    }
    expect(seen.length).toBeGreaterThan(0)
  },
  20000,
)
