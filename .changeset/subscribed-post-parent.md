---
'@bsky/sdk': patch
---

Add an optional `parent` to `subscribedPostItem` in `app.bsky.notification.getGroupedNotifications`, so a subscribed post that is a reply names its parent, as reply, quote and mention notifications do
