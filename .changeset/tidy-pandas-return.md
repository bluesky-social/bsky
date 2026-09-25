---
'@bsky/sdk': patch
---

Add an optional `since` parameter and an optional `startCursor` output field to `app.bsky.feed.getTimeline` and `app.bsky.feed.getListFeed`, for fetching a bounded range of newer content.
