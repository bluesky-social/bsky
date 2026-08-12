import { expect, test } from 'vitest'
import { makeSelector } from '../../src/engine/selector.js'
import type { SegEvent } from '../../src/segment/block.js'
import { SegKind } from '../../src/segment/kind.js'

const row = (over: Record<string, unknown> = {}): SegEvent =>
  ({
    seq: 10,
    witnessedAt: 1,
    indexedAt: 0,
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

test('seq window prunes rows outside (afterSeq, beforeSeq]', () => {
  const window = { afterSeq: 10, beforeSeq: 12 }
  const sel = makeSelector({ collections: [], window })
  expect(sel.keep(row({ seq: 10 }))).toBe(false) // exclusive floor
  expect(sel.keep(row({ seq: 11 }))).toBe(true)
  expect(sel.keep(row({ seq: 12 }))).toBe(true) // inclusive ceiling
  expect(sel.keep(row({ seq: 13 }))).toBe(false)
  // identity rows are bound by the window too
  expect(
    sel.keep(row({ seq: 9, kind: SegKind.Identity, collection: '' })),
  ).toBe(false)
})

test('seq window is read live: advancing the floor mid-run takes effect', () => {
  const window = { afterSeq: 0 }
  const sel = makeSelector({ collections: [], window })
  expect(sel.keep(row({ seq: 5 }))).toBe(true)
  window.afterSeq = 5
  expect(sel.keep(row({ seq: 5 }))).toBe(false)
  expect(sel.keep(row({ seq: 6 }))).toBe(true)
})
