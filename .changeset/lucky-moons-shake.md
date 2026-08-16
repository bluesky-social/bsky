---
'@bsky/sdk': patch
---

Detect where a link's host actually ends, and validate it by parsing the URL
and checking the TLD. Text like `stream.place's` now links `stream.place` and
leaves `'s` as text, instead of linking `https://stream.place's`. Explicit
`https://` links are host-checked too, rather than being trusted on sight.
