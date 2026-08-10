---
'@bsky/sdk': major
---

The Bluesky SDK, built on `@atproto/lex`. The package provides:

- Typed actions for common Bluesky operations — posts, likes, reposts, follows, profile upserts, graph mutes/blocks, notifications, and the full preferences suite — invoked via `client.call(action, input)` on a lex `Client`.
- `/lexicons` — generated schemas and types for the `app.bsky`, `com.atproto`, and `chat.bsky` namespaces, importable by namespace root.
- `/moderation` — the moderation engine (`moderatePost`, `moderateProfile`, label handling, mute words) for interpreting labels and preferences into UI decisions.
- `/richtext` — `RichText` with facet detection and handle resolution (including the one-step `RichText.resolve()`), sanitization, and unicode utilities.
- `/utils` — age assurance helpers, `ClientHandleResolver`, muted-word and nux utilities.
- `api.*` constants with Bluesky-operated service addresses (AppView, chat, moderation).

Note: this package supersedes the Bluesky portions of `@atproto/api` (Agent classes are not carried over — a lex `Client` fills that role). See `skills/upgrade-from-atproto-api` for migration guidance.
