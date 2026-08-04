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

## Isomorphic

This package runs on Node.js and in the browser. The live transport is built
on `@atproto/ws-client`, which selects a platform websocket implementation
itself; nothing in `src/` imports Node-only modules (`ws` is a devDependency
used only by tests).

Websocket behavior (reconnect policy, lifecycle hooks, headers, liveness) is
configured through the `websocketTransport()` factory and passed via the
`liveTransport` option:

```ts
import { Jetstream, websocketTransport } from '@bsky.app/jetstream'

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

Defaults: frames are text (`dataMode: 'text'`; a binary frame is fatal), a
server's clean close reconnects (the resume cursor makes redials seamless),
and a 60s idle timeout redials silent connections (`idleTimeoutMs: false`
disables). Under these defaults a live stream never ends on its own — only
`break`, aborting the `signal`, or a genuinely fatal error ends it.

Two error surfaces, one sentence each: the factory's `onError` reports the
stream-fatal websocket error (the same error the loop rejects with), while
`LiveOpts.onError` reports skipped malformed frames at the decode layer.
