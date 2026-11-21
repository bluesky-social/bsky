---
'@bsky/jetstream': minor
---

Add opt-in Spaces support for space-sync archives: `new Jetstream({ service, mode: 'spaces' })` negotiates and verifies protocol version 2, adds `space` to commit and sync events, adds `scope` lifecycle events (`repoRemoved`, `spaceDeleted`), optional ordered `progress` items with runner checkpointing, `scopedRecordKey()`, `ProtocolError`, and a serial `LexIndexer({ mode: 'spaces' })`. Public clients send the same requests and get the same events and types as before.
