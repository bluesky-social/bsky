# @bsky.app/jetstream

Client library for [Jetstream](https://github.com/bluesky-social/jetstream), a friendly way to consume data published to AT Protocol in realtime.

## Quick start

Install the Jetstream client:

```
npm install @bsky.app/jetstream
```

This package currently supports Jetstream's WebSocket-based live mode. Consuming events looks like:

```ts
import { Jetstream } from '@bsky.app/jetstream'

const js = new Jetstream('https://jetstream1.us-east.bsky.network')

for await (const evt of js.live({ collections: ['app.bsky.feed.post'] })) {
  if (evt.kind === 'commit' && evt.commit.operation === 'create') {
    console.log(evt.commit.collection, evt.commit.record)
  }
}
```

Using a lexicon as your collection filter will validate and type the events for you:

```ts
import { Jetstream } from '@bsky.app/jetstream'
import { app } from '@bsky.app/sdk/lexicons'

const js = new Jetstream('https://jetstream1.us-east.bsky.network')

for await (const evt of js.live({ collections: [app.bsky.feed.post] })) {
  if (evt.kind === 'commit' && evt.commit.operation === 'create') {
    console.log(evt.commit.collection, evt.commit.record.text)
  }
}
```

For indexing workloads, `LexIndexer` dispatches schema-validated records to per-collection handlers with bounded concurrency and per-record ordering, and `JetstreamRunner` drives it with durable cursor tracking:

```ts
import { Jetstream, LexIndexer, MemoryCursorStore } from '@bsky.app/jetstream'
import { app } from '@bsky.app/sdk/lexicons'

const js = new Jetstream('https://jetstream1.us-east.bsky.network')

const indexer = new LexIndexer()
  .commit(app.bsky.feed.like, {
    put: async (e) => {
      console.log('index', e.uri, e.record)
    },
    del: async (e) => {
      console.log('remove', e.uri)
    },
  })
  .identity(async (e) => {
    console.log('identity change', e.did, e.handle)
  })

// Implement CursorStore to persist the resume cursor durably.
const cursor = new MemoryCursorStore()

await js.runner(indexer).live({ cursor })
```
