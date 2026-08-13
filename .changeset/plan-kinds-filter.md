---
---

Push the `kinds` filter down to `planSnapshot` so `snapshot()`/`replay()` skip whole archive blocks server-side instead of downloading and discarding them, and reject filter combinations the server refuses (over-cap `kinds`/`dids`/`collections` lists, and `collections` paired with a `kinds` list that excludes `commit`) locally rather than as an opaque handshake failure. No published-package changes — `@bsky/jetstream` is unreleased and its pending initial-release changeset already covers filtering.
