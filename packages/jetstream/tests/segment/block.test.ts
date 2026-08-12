import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { decodeBlockFrame } from '../../src/segment/block.js'
import { nodeDecompressor } from '../../src/segment/decompressor.js'
import { SegKind } from '../../src/segment/kind.js'

const d = await nodeDecompressor()

const golden = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

// Pinned input from the jetstream server's segment/block_golden_test.go.
test('decodes the Go golden block frame exactly', () => {
  const rows = decodeBlockFrame(golden, d)
  expect(rows).toHaveLength(3)

  expect(rows[0]).toMatchObject({
    seq: 1,
    indexedAt: 1700000000_000000,
    renderedAt: 0,
    kind: SegKind.Create,
    did: 'did:plc:abcdefghijklmnopqrstuvwx',
    collection: 'app.bsky.feed.post',
    rkey: '3l3qo2vuowo2b',
    rev: '3l3qo2vutsw2b',
  })
  expect(Array.from(rows[0].payload!)).toEqual([
    0xa1, 0x65, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x05,
  ])

  expect(rows[1]).toMatchObject({
    seq: 2,
    indexedAt: 1700000001_000000,
    renderedAt: 1700000000_500000,
    kind: SegKind.Identity,
    did: 'did:web:example.com',
    collection: '',
    rkey: '',
    rev: '',
  })
  expect(rows[1].payload).toBeNull()

  expect(rows[2]).toMatchObject({
    seq: 3,
    kind: SegKind.Delete,
    did: 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz',
    collection: 'app.bsky.feed.like',
    rkey: '3l3qo2vuowo2c',
    rev: '3l3qo2vutsw2c',
  })
  expect(rows[2].payload).toBeNull()
})

test('empty block decodes to []', () => {
  // event_count = 0, no other bytes
  const frame = new Uint8Array(zstdCompressSync(new Uint8Array([0, 0, 0, 0])))
  expect(decodeBlockFrame(frame, d)).toEqual([])
})
