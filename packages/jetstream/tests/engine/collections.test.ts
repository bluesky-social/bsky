import { expect, test } from 'vitest'
import { collectionMatches } from '../../src/engine/collections.js'

test('exact match', () => {
  expect(collectionMatches('app.bsky.feed.post', ['app.bsky.feed.post'])).toBe(
    true,
  )
  expect(collectionMatches('app.bsky.feed.like', ['app.bsky.feed.post'])).toBe(
    false,
  )
})

test('wildcard match', () => {
  expect(collectionMatches('app.bsky.feed.post', ['app.bsky.feed.*'])).toBe(
    true,
  )
  expect(collectionMatches('app.bsky.graph.follow', ['app.bsky.feed.*'])).toBe(
    false,
  )
})

test('empty filters match all', () => {
  expect(collectionMatches('anything', [])).toBe(true)
})
