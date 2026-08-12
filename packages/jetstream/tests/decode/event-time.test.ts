import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
  microsToDatetime,
  rawEventFromSegment,
} from '../../src/decode-event.js'
import { defaultDecompressor, defaultSha256 } from '../../src/runtime/node.js'
import { decodeBlockFrame } from '../../src/segment/block.js'

const decompressor = defaultDecompressor()
const sha256 = defaultSha256()

const rows = decodeBlockFrame(
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
    ),
  ),
  decompressor,
)

test('microsToDatetime matches the live wire format (RFC 3339, 6 fractional digits, UTC)', () => {
  expect(microsToDatetime(1725911162_329308)).toBe(
    '2024-09-09T19:46:02.329308Z',
  )
  expect(microsToDatetime(1700000000_000000)).toBe(
    '2023-11-14T22:13:20.000000Z',
  )
  expect(microsToDatetime(123)).toBe('1970-01-01T00:00:00.000123Z')
})

test('event time is witnessedAt unless an imported indexedAt is present', () => {
  // Golden row 0: witnessedAt only (indexedAt 0) — display = witnessed.
  const ev0 = rawEventFromSegment(rows[0], { sha256 })
  expect(ev0.time).toBe(microsToDatetime(1700000000_000000))
  // Golden row 1: imported indexedAt (nonzero) wins — same rule as the
  // server's live encoder (segment/event.go DisplayTime).
  const ev1 = rawEventFromSegment(rows[1], { sha256 })
  expect(ev1.time).toBe(microsToDatetime(1700000000_500000))
})
