---
'@bsky/sdk': minor
---

Restrict the supported `@atproto/lex` peer range to `>=0.3.0 <0.3.10`. Releases 0.3.10–0.3.14 re-export conflicting `walk` declarations with current dependencies and fail TypeScript declaration checking. Align the development dependency with the supported range.
