# @bsky.app/jetstream

Client library for [Jetstream](https://github.com/bluesky-social/jetstream), the
Bluesky-operated atproto event stream with JSON framing and server-side
filtering.

This package currently supports Jetstream's live mode (the public
`jetstream*.bsky.network` instances). Consuming events looks like:

```ts
import { Jetstream } from '@bsky.app/jetstream'

const js = new Jetstream('https://jetstream1.us-east.bsky.network')

for await (const evt of js.live({ collections: ['app.bsky.feed.post'] })) {
  if (evt.kind === 'commit' && evt.commit.operation !== 'delete') {
    console.log(evt.commit.collection, evt.commit.record)
  }
}
```

For indexing workloads, `LexIndexer` dispatches schema-validated records to
per-collection handlers with bounded concurrency and per-record ordering, and
`JetstreamRunner` drives it with durable cursor tracking:

```ts
import { Jetstream, LexIndexer } from '@bsky.app/jetstream'

const indexer = new LexIndexer()
  .commit(likeSchema, {
    put: async (e) => {
      /* index e.record */
    },
    del: async (e) => {
      /* remove by e.uri */
    },
  })
  .identity(async (e) => {
    /* handle changes */
  })

await js.runner(indexer).live({ cursor: myCursorStore })
```
