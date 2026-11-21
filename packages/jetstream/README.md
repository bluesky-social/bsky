# @bsky/jetstream

Client library for [Jetstream](https://github.com/bluesky-social/jetstream), a friendly way to consume data published to AT Protocol in realtime.

## Quick start

Install the Jetstream client:

```
npm install @bsky/jetstream @atproto/lex
```

`@atproto/lex` is a peer dependency providing the lexicon type system that events are typed with.

This package speaks Jetstream's v2 wire and supports all three of its consumption modes: `live()` for realtime events, `snapshot()` for the sealed archive of past events, and `replay()` for the archive followed by a seamless handoff to realtime. Consuming live events looks like:

```ts
import { Jetstream, isCreate } from '@bsky/jetstream'

const js = new Jetstream('https://jetstream.us-east.bsky.network')

for await (const evt of js.live({ collections: ['app.bsky.feed.post'] })) {
  if (isCreate(evt)) {
    console.log(evt.commit.collection, evt.commit.record)
  }
}
```

`collections` constrains **commit** events only — identity, account, and sync events flow regardless — so a commits-only stream also needs `kinds: ['commit']`. `kinds` accepts `commit`, `identity`, `account`, and `sync`, and omitting it means all kinds. Conversely, a `kinds` list without `commit` leaves `collections` with nothing to constrain: that pair is rejected rather than silently ignoring either side.

Using a lexicon as your collection filter will validate and type the events for you:

```ts
import { Jetstream, isCreate } from '@bsky/jetstream'
import { app } from '@bsky/sdk/lexicons'

const js = new Jetstream('https://jetstream.us-east.bsky.network')

for await (const evt of js.live({ collections: [app.bsky.feed.post] })) {
  if (isCreate(evt)) {
    console.log(evt.commit.collection, evt.commit.record.text)
  }
}
```

`isCreate()`, `isUpdate()`, `isDelete()`, and `isPut()` (create-or-update) narrow an event to a commit with that operation. Pass a lexicon — or a bare NSID — as a second argument to also narrow to its collection: `isCreate(evt, app.bsky.feed.post)`. The record narrows exactly as `app.bsky.feed.post.$isTypeOf()` would narrow it, so a record the event already types precisely keeps that type. Like `$isTypeOf()`, these helpers narrow types without validating; when shape guarantees matter, use a validating collection filter as above.

Typed records are converted lex data — `Cid`, `Uint8Array`, and `BlobRef` values rather than wire JSON's `{$link}` / `{$bytes}` shapes. Pass `live({ raw: true })` when you want the wire-faithful record instead (its `$link`/`$bytes` markers intact).

A validating collection filter (a lexicon, or `{ collection, validateRecord: true }`, the default) routes a schema-invalid record away from delivery. Passing `validateRecord: false` only drops the _schema_ check — a record that isn't a `$type`'d map still fails conversion and is skipped, reported via `onError` (or, for `LexIndexer`, `onValidationError`) rather than delivered.

For indexing workloads, `LexIndexer` dispatches schema-validated records to per-collection handlers with bounded concurrency and per-record ordering, and `JetstreamRunner` drives it with durable cursor tracking. The runner asks the server only for the kinds a `LexIndexer` has registered handlers for — register `.identity()`/`.account()`/`.sync()` (or a collection via `.commit()`) to receive that kind at all:

```ts
import { Jetstream, LexIndexer, MemoryCursorStore } from '@bsky/jetstream'
import { app } from '@bsky/sdk/lexicons'

const js = new Jetstream('https://jetstream.us-east.bsky.network')

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

### Cursors

`live()`'s cursor is a v2 `seq`. Values `>= 1e15` are read by the server as unix-microsecond timestamps instead. When the server clamps a stale timestamp it sends an `OutdatedCursor` advisory, reported through `onInfo` without ending the stream — an advisory is dropped silently if no `onInfo` is registered.

Cursors are **not portable between versions**: a v1 cursor is a `time_us` value and a v2 cursor is a `seq`. Never replay a stored cursor against the other version.

### Legacy v1 instances

The public `jetstream*.bsky.network` hosts speak the legacy v1 format. Use `JetstreamV1`, which offers `live()` only — v1 does not support historical network replay, has no `kinds` filter, and no runner/indexer path.

```ts
import { JetstreamV1 } from '@bsky/jetstream'

const js = new JetstreamV1('https://jetstream1.us-east.bsky.network')
for await (const evt of js.live({ collections: ['app.bsky.feed.post'] })) {
  console.log(evt.seq, evt.kind)
}
```

## Spaces archives

A space-sync archive also streams records that live inside _spaces_ (private or shared namespaces). Turn this on per client with `mode: 'spaces'`. Without it, nothing changes: a public client sends the same requests and sees the same events and types as before.

```ts
import { Jetstream, scopedRecordKey } from '@bsky/jetstream'

const js = new Jetstream({ service: 'https://archive.example', mode: 'spaces' })

for await (const evt of js.replay({ progress: true })) {
  switch (evt.kind) {
    case 'commit':
      // evt.space is set for a record inside a space, absent for a public one.
      console.log(
        scopedRecordKey({ space: evt.space, did: evt.did, ...evt.commit }),
      )
      break
    case 'scope':
      // repoRemoved: drop everything evt.did wrote in evt.space.
      // spaceDeleted: drop everything in evt.space (there is no did).
      console.log(evt.scope.operation, evt.space)
      break
    case 'progress':
      // Every event up to evt.throughSeq has been delivered.
      console.log(evt.throughSeq, evt.caughtUp)
      break
  }
}
```

What Spaces mode adds:

- **Version check.** Each `live()`, `snapshot()`, `replay()` or runner call asks the server for its capabilities once, requires protocol version 2, and sends that version on every request. The server must confirm it in the `Jetstream-Protocol-Version` (and, for archive files, `Jetstream-Format-Version`) response header. A server that cannot do this, including one without `getCapabilities`, fails with `ProtocolError`. There is no fallback to the public protocol.
- **`space`** on `commit` and `sync` events. A `sync` with a `space` resets only that space; `identity` and `account` events stay global. The same record path can exist in several spaces, so key stored records with `scopedRecordKey()`, not the AT URI alone.
- **`scope` events** (`kinds` may include `'scope'`): `repoRemoved` (with `did`, and optional `cause` and `lastKnownRev`) and `spaceDeleted` (no `did`). A `dids` filter keeps `spaceDeleted`, and a `collections` filter keeps all lifecycle events (`scope`, `sync`, `account`, `identity`).
- **`progress: true`** (optional) adds `{ kind: 'progress', throughSeq, caughtUp }` items. `throughSeq` covers every event up to it, including events your filters removed, and `0` is a valid value. The sealed archive part of a `replay()` or `snapshot()` never reports `caughtUp: true`; only the live server does. If the client had to skip an event (an unknown live message, or a record that failed validation), it stops reporting progress for the rest of that call. Raw batch streams carry it as `batch.progress`.

For indexing, use `new LexIndexer({ mode: 'spaces' })`. It runs handlers one at a time, in order, because a `scope` event or a scoped `sync` can affect many records at once (`concurrency` and `keyOf` are rejected). Handler inputs include `space` when present, and `.scope()` registers the lifecycle handler. A Spaces runner only accepts a Spaces consumer, and with `progress: true` it saves the cursor past filtered-out ranges once every earlier event has been handled:

```ts
const indexer = new LexIndexer({ mode: 'spaces' })
  .commit(app.example.note, {
    put: async (e) => save(scopedRecordKey(e), e.record),
    del: async (e) => remove(scopedRecordKey(e)),
  })
  .sync(async (e) => resetRepo(e.did, e.space))
  .scope(async (e) =>
    e.operation === 'repoRemoved'
      ? removeRepo(e.space, e.did)
      : removeSpace(e.space),
  )

await js.runner(indexer).replay({ cursor, progress: true })
```

Live Spaces streams must check the WebSocket upgrade response headers. The built-in transport does this on Node.js. Browsers do not expose those headers, so in a browser a Spaces `live()` or `replay()` fails with `ProtocolError` unless you pass a `liveTransport` that reports them through `LiveTransportOpts.onUpgrade`.

## Connection behavior

This package runs on Node.js and in the browser.

A live stream stays up on its own: it reconnects automatically — including when the server closes cleanly or goes silent — and resumes from its cursor, so no events are lost or duplicated across reconnects. It ends only when you `break` out of the loop, abort the `signal`, or a genuinely fatal error occurs (which rejects the loop).

To observe or tune connection behavior, configure a transport with `websocketTransport()` and pass it via the `liveTransport` option:

```ts
import { Jetstream, websocketTransport } from '@bsky/jetstream'

const js = new Jetstream('https://jetstream.us-east.bsky.network')
for await (const ev of js.live({
  collections: ['app.bsky.feed.post'],
  liveTransport: websocketTransport({
    onReconnect: (err, { attempt }) => console.warn('reconnecting', attempt),
  }),
})) {
  // ...
}
```

Commonly useful options: `onReconnect` to observe connection trouble (retries are otherwise silent), `shouldReconnect` to change when the stream gives up, and `idleTimeoutMs` to tune dead-connection detection (default 60s; `false` disables). `websocketTransport()` inherits the rest of its options from [`@atproto/ws-client`](https://npmx.dev/@atproto/ws-client).
