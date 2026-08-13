# @bsky/jetstream

## 1.0.0

### Major Changes

- [#21](https://github.com/bluesky-social/bsky/pull/21) [`c27aa4c`](https://github.com/bluesky-social/bsky/commit/c27aa4c0ea7c7389ce7c83a3aeb1726df287a092) Thanks [@devinivy](https://github.com/devinivy)! - Client library for Jetstream, a friendly way to consume data published to AT Protocol. The package provides:

  - `Jetstream` with three consumption modes: `live()` streams the network in realtime, `replay()` continuously streams full network history, and `snapshot()` streams network history up to the current moment.
  - Typed events by default: records arrive as lex data, validated against schemas when collections are given as lexicon schema filters. `raw: true` yields wire-faithful events instead (parsed JSON from the live stream, DAG-CBOR bytes from snapshots, with lazily computed CIDs).
  - `isCreate()`, `isUpdate()`, `isDelete()`, and `isPut()` narrow an event to a commit with that operation, and to one collection's records when given a lexicon — the same narrowing `$isTypeOf()` performs.
  - Filtering by `collections` (exact NSIDs or `ns.*` wildcards), `dids`, and `kinds`, applied consistently across all three modes.
  - `LexIndexer` — register per-collection put/delete handlers plus identity, account, and sync handlers, with record validation and per-record ordered concurrency.
  - `JetstreamRunner` — drive a consumer such as `LexIndexer` through any mode with durable cursor tracking: progress persists through a `CursorStore` and resumes where it left off.
  - Resilience built in: the live stream reconnects and resumes from its cursor, snapshot downloads retry with backoff and resume mid-file, and interrupted snapshots re-plan without re-delivering.
  - `apiKey` option for hosts that require auth — sent on snapshot downloads and the live websocket handshake alike.
  - Works in Node.js (>= 22.15) and the browser, with `@atproto/lex` as a peer dependency. Live streaming is fully browser-capable; snapshot and replay need `decompressor` and `sha256` options supplied in the browser, where the platform lacks zstd and synchronous hashing.
  - `JetstreamV1` — a live-only client for hosts still speaking the original Jetstream wire protocol.
