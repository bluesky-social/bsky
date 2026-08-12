import { expect, test } from 'vitest'
import { makeSelector } from '../../src/engine/selector.js'
import { SegKind } from '../../src/segment/kind.js'
import type { SegEvent } from '../../src/segment/block.js'

const row = (over: Record<string, unknown> = {}): SegEvent =>
  ({
    seq: 10,
    indexedAt: 1,
    renderedAt: 0,
    kind: SegKind.Create,
    did: 'did:plc:a',
    collection: 'app.bsky.feed.post',
    rkey: 'k',
    rev: 'r',
    payload: null,
    ...over,
  }) as unknown as SegEvent

test('filters by did', () => {
  const sel = makeSelector({ dids: ['did:plc:a'], collections: [] })
  expect(sel.keep(row())).toBe(true)
  expect(sel.keep(row({ did: 'did:plc:b' }))).toBe(false)
})

test('filters by collection', () => {
  const sel = makeSelector({ collections: ['app.bsky.feed.like'] })
  expect(sel.keep(row())).toBe(false)
  expect(sel.keep(row({ collection: 'app.bsky.feed.like' }))).toBe(true)
})

test('identity/account/sync rows bypass the collection filter', () => {
  const sel = makeSelector({ collections: ['app.bsky.feed.like'] })
  // a commit not matching the collection is dropped
  expect(
    sel.keep(row({ kind: SegKind.Create, collection: 'app.bsky.feed.post' })),
  ).toBe(false)
  // an identity row (no collection) passes even with a restrictive collection filter
  expect(sel.keep(row({ kind: SegKind.Identity, collection: '' }))).toBe(true)
})
