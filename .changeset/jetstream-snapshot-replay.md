---
'@bsky/jetstream': minor
---

Sealed-archive support: `snapshot()` streams the archive (typed events, or wire-faithful DAG-CBOR records with `raw: true`) with exact client-side filtering, resumable downloads, and bounded re-plan recovery; `replay()` backfills the archive then cuts over to the live stream at the sealed tip with no gap and no duplicate, recovering when the backfill outruns the live retention window. The runner gains `snapshot()`/`replay()` modes on the same cursor-tracking seam as `live()`. New `apiKey` option sends `Authorization: Bearer` on snapshot downloads and the live handshake. Platform defaults for zstd and sync sha256 resolve via a `#runtime` package.json imports condition — Node uses node:zlib/node:crypto; browsers must inject `decompressor`/`sha256` options to use snapshot/replay (`live()` is unaffected). Requires Node >= 22.15. Also fixes a cursor bug where a run that acked nothing could overwrite a stored cursor with 0.
