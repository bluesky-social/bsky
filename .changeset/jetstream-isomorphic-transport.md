---
'@bsky.app/jetstream': minor
---

Isomorphic live transport: adopt `@atproto/ws-client` 0.2.0 (Node.js + browser). New `websocketTransport(options)` factory exposes websocket options (reconnect policy, lifecycle hooks, headers, liveness) as the existing `liveTransport` seam. Defaults: text frames only (binary is fatal), reconnect on a server's clean close, 60s idle timeout (`false` disables) — under defaults a live stream never ends on its own.
