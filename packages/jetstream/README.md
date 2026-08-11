# @bsky/jetstream

Client library for [Jetstream](https://github.com/bluesky-social/jetstream), a friendly way to consume data published to AT Protocol in realtime.

## Quick start

Install the Jetstream client:

```
npm install @bsky/jetstream
```

This package currently supports Jetstream's WebSocket-based live mode. Consuming events looks like:

```ts
import { Jetstream } from '@bsky/jetstream'

const js = new Jetstream('https://jetstream1.us-east.bsky.network')

for await (const evt of js.live({ collections: ['app.bsky.feed.post'] })) {
  if (evt.kind === 'commit' && evt.commit.operation === 'create') {
    console.log(evt.commit.collection, evt.commit.record)
  }
}
```

Using a lexicon as your collection filter will validate and type the events for you:

```ts
import { Jetstream } from '@bsky/jetstream'
import { app } from '@bsky/sdk/lexicons'

const js = new Jetstream('https://jetstream1.us-east.bsky.network')

for await (const evt of js.live({ collections: [app.bsky.feed.post] })) {
  if (evt.kind === 'commit' && evt.commit.operation === 'create') {
    console.log(evt.commit.collection, evt.commit.record.text)
  }
}
```

For indexing workloads, `LexIndexer` dispatches schema-validated records to per-collection handlers with bounded concurrency and per-record ordering, and `JetstreamRunner` drives it with durable cursor tracking:

```ts
import { Jetstream, LexIndexer, MemoryCursorStore } from '@bsky/jetstream'
import { app } from '@bsky/sdk/lexicons'

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

## Connection behavior

This package runs on Node.js and in the browser.

A live stream stays up on its own: it reconnects automatically — including
when the server closes cleanly or goes silent — and resumes from its cursor,
so no events are lost or duplicated across reconnects. It ends only when you
`break` out of the loop, abort the `signal`, or a genuinely fatal error
occurs (which rejects the loop).

To observe or tune connection behavior, configure a transport with
`websocketTransport()` and pass it via the `liveTransport` option:

```ts
import { Jetstream, websocketTransport } from '@bsky/jetstream'

const js = new Jetstream('https://jetstream2.us-east.bsky.network')
for await (const ev of js.live({
  collections: ['app.bsky.feed.post'],
  liveTransport: websocketTransport({
    onReconnect: (err, { attempt }) => console.warn('reconnecting', attempt),
  }),
})) {
  // ...
}
```

Commonly useful options: `onReconnect` to observe connection trouble (retries
are otherwise silent), `shouldReconnect` to change when the stream gives up,
and `idleTimeoutMs` to tune dead-connection detection (default 60s; `false`
disables). `websocketTransport()` inherits the rest of its options from
[`@atproto/ws-client`](https://npmx.dev/@atproto/ws-client).
