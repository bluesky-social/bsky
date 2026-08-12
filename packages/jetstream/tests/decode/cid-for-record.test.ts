import { expect, test } from 'vitest'
import { encode as cborEncode } from '@atproto/lex-cbor'
import { cidForCbor } from '@atproto/lex'
import { cidForRecord, nodeSha256 } from '../../src/decode-event.js'

const sha256 = await nodeSha256()

test('cidForRecord is synchronous and matches the CIDv1 dag-cbor shape', () => {
  const payload = cborEncode({ $type: 'app.bsky.feed.post', text: 'hi' })
  // Synchronous: returns a string directly, not a Promise.
  const cid = cidForRecord(payload, sha256)
  expect(typeof cid).toBe('string')
  expect(cid).toMatch(/^bafy/)
})

test('cidForRecord equals the async cidForCbor', async () => {
  for (const record of [
    { $type: 'app.bsky.feed.post', text: 'hi' },
    { $type: 'app.bsky.feed.like', subject: { uri: 'at://x', cid: 'bafy' } },
    {},
  ]) {
    const payload = cborEncode(record)
    const expected = (await cidForCbor(payload)).toString()
    expect(cidForRecord(payload, sha256)).toBe(expected)
  }
})
