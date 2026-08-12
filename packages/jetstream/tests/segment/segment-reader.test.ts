import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { defaultRuntime } from '../../src/runtime/node.js'
import { SegKind } from '../../src/segment/kind.js'
import {
  decodeSegment,
  readSealedHeader,
} from '../../src/segment/segment-reader.js'

const d = defaultRuntime.zstdDecompressor()

const seal = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_seal.bin', import.meta.url)),
  ),
)

// Pinned input from the jetstream server's segment/seal_test.go TestSealGolden:
// 2 events, MaxEventsPerBlock=2 -> 1 block. Payloads are opaque bytes "p1"/"p2".
test('parses the sealed header', () => {
  const h = readSealedHeader(seal)
  expect(h.version).toBe(1)
  expect(h.eventCount).toBe(2)
  expect(h.blockCount).toBeGreaterThanOrEqual(1)
})

test('decodes all events in the sealed segment', () => {
  const rows = decodeSegment(seal, d)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    seq: 1,
    witnessedAt: 100,
    kind: SegKind.Create,
    did: 'did:plc:a',
    collection: 'app.bsky.feed.post',
    rkey: 'k1',
    rev: 'v1',
  })
  expect(new TextDecoder().decode(rows[0].payload!)).toBe('p1')
  expect(rows[1].did).toBe('did:plc:b')
  expect(new TextDecoder().decode(rows[1].payload!)).toBe('p2')
})

test('rejects bad magic', () => {
  const bad = seal.slice()
  bad[0] = 0
  expect(() => readSealedHeader(bad)).toThrow()
})
