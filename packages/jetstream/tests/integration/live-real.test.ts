import { expect, test } from 'vitest'
import { JetstreamV1 } from '../../src/jetstream-v1.js'
import { Jetstream } from '../../src/jetstream.js'

const HOST = process.env.JETSTREAM_LIVE_HOST // e.g. https://jetstream1.us-east.bsky.network
// The public jetstream*.bsky.network hosts speak v1 today. Set
// JETSTREAM_LIVE_VERSION=2 to point this at a v2 deployment.
const VERSION = process.env.JETSTREAM_LIVE_VERSION === '2' ? 2 : 1
const maybe = HOST ? test : test.skip

maybe(
  'live() decodes real frames from a running jetstream',
  async () => {
    const signal = AbortSignal.timeout(15000)
    // Calling live() on a Jetstream | JetstreamV1 union does not
    // overload-resolve (the two classes' live() overload sets don't
    // reconcile across the union), so each branch calls its own live() and
    // only the resulting generators are unioned.
    const stream =
      VERSION === 2
        ? new Jetstream(HOST!).live({
            collections: ['app.bsky.feed.post'],
            signal,
          })
        : new JetstreamV1(HOST!).live({
            collections: ['app.bsky.feed.post'],
            signal,
          })
    const seen: string[] = []
    for await (const e of stream) {
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
