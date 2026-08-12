---
'@bsky/jetstream': major
---

Client library for Jetstream, a friendly way to consume data published to AT Protocol. The package provides:

- `Jetstream` with three consumption modes: `live()` streams events in realtime, `snapshot()` streams the sealed archive of past events, and `replay()` streams the archive then hands off seamlessly to the live stream — no gap, no duplicate, recovering on its own when a long replay falls behind the live retention window.
- Typed events by default: records arrive as lex data, validated against schemas when collections are given as lexicon schema filters. `raw: true` yields wire-faithful events instead (parsed JSON from the live stream, DAG-CBOR bytes from snapshots, with lazily computed CIDs).
- Filtering by `collections` (exact NSIDs or `ns.*` wildcards), `dids`, and `kinds`, applied consistently across all three modes.
- `LexIndexer` — register per-collection put/delete handlers plus identity, account, and sync handlers, with record validation and per-record ordered concurrency.
- `JetstreamRunner` — drive a consumer such as `LexIndexer` through any mode with durable cursor tracking: progress persists through a `CursorStore` and resumes where it left off.
- Resilience built in: the live stream reconnects and resumes from its cursor, snapshot downloads retry with backoff and resume mid-file, and interrupted snapshots re-plan without re-delivering.
- `apiKey` option for hosts that require auth — sent on snapshot downloads and the live websocket handshake alike.
- Works in Node.js (>= 22.15) and the browser. Live streaming is fully browser-capable; snapshot and replay need `decompressor` and `sha256` options supplied in the browser, where the platform lacks zstd and synchronous hashing.
- `JetstreamV1` — a live-only client for hosts still speaking the original Jetstream wire protocol.
