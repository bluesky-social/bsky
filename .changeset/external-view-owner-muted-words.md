---
'@bsky/sdk': patch
---

Include backing-record owner moderation in `moderateExternalView` and `moderateViewExternal`. Both accept an optional third argument, `{ texts: string[] }`, for client-selected muted-word matching.
