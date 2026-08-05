import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type DnsConfig,
  evaluateGroup,
  groupForFile,
  planChecks,
} from './lex-check-dns.ts'

const config: DnsConfig = {
  did: 'did:plc:test123',
  carveouts: ['app.bsky.unspecced'],
}

test('groupForFile derives the NSID group from a lexicon path', () => {
  assert.equal(
    groupForFile('lexicons/app/bsky/feed/post.json'),
    'app.bsky.feed',
  )
  assert.equal(
    groupForFile('lexicons/chat/bsky/convo/defs.json'),
    'chat.bsky.convo',
  )
})

test('groupForFile rejects paths outside lexicons/', () => {
  assert.throws(() => groupForFile('other/app/bsky/feed/post.json'))
})

test('groupForFile rejects paths too shallow to have a group', () => {
  assert.throws(() => groupForFile('lexicons/app/thing.json'))
})

test('planChecks dedupes files into one representative NSID per group', () => {
  const plan = planChecks([
    'lexicons/app/bsky/feed/post.json',
    'lexicons/app/bsky/feed/like.json',
    'lexicons/chat/bsky/convo/defs.json',
  ])
  assert.deepEqual(plan, [
    { group: 'app.bsky.feed', nsid: 'app.bsky.feed.post' },
    { group: 'chat.bsky.convo', nsid: 'chat.bsky.convo.defs' },
  ])
})

test('expected group resolving to expected did is ok', () => {
  const status = evaluateGroup('app.bsky.feed', 'did:plc:test123', config)
  assert.deepEqual(status, { status: 'ok' })
})

test('expected group failing to resolve is a violation', () => {
  const status = evaluateGroup('app.bsky.feed', null, config)
  assert.equal(status.status, 'violation')
  assert.match(status.message, /missing/i)
})

test('expected group resolving to another did is a violation', () => {
  const status = evaluateGroup('app.bsky.feed', 'did:plc:other', config)
  assert.equal(status.status, 'violation')
  assert.match(status.message, /did:plc:other/)
})

test('carveout group with no dns is an intentional skip', () => {
  const status = evaluateGroup('app.bsky.unspecced', null, config)
  assert.deepEqual(status, { status: 'carveout' })
})

test('carveouts match groups exactly, not by prefix', () => {
  const status = evaluateGroup('app.bsky.unspecced.deep', null, config)
  assert.equal(status.status, 'violation')
})

test('carveout group that resolves is a violation', () => {
  const status = evaluateGroup('app.bsky.unspecced', 'did:plc:test123', config)
  assert.equal(status.status, 'violation')
  assert.match(status.message, /carveout/i)
})
