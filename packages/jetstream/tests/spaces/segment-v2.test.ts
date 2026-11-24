import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { MalformedError } from '../../src/errors.js'
import { defaultRuntime } from '../../src/runtime/node.js'
import { decodeBlock, decodeBlockFrame } from '../../src/segment/block.js'
import { readSealedHeader } from '../../src/segment/header.js'
import { SegKind } from '../../src/segment/kind.js'
import {
  decodeSegment,
  readBlockFrame,
  streamSegmentFrames,
} from '../../src/segment/segment-reader.js'

// Go-produced fixtures (space-sync third_party/jetstream segment package:
// EncodeBlockFrameVersion(rows, 2), a sealed FormatVersion 2 Writer with
// MaxEventsPerBlock 3, and a Rewrite-emptied v2 block). The manifest is the
// Go reader's decode of the same rows.
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    ),
  )
interface ManifestRow {
  seq: number
  witnessedAt: number
  indexedAt: number
  kind: number
  space: string
  did: string
  collection: string
  rkey: string
  rev: string
  payload: string | null
}
const manifest = JSON.parse(
  new TextDecoder().decode(fixture('spaces_fixtures.json')),
) as {
  block: { rows: ManifestRow[] }
  segment: { rows: ManifestRow[]; blockCount: number; blockRowCounts: number[] }
}
const d = defaultRuntime.zstdDecompressor()
const v2Block = fixture('spaces_block_v2.bin')
const v2Empty = fixture('spaces_block_v2_empty.bin')
const v2Seal = fixture('spaces_seal_v2.bin')
const v1Block = fixture('golden_block.bin')
const v1Seal = fixture('golden_seal.bin')

const hex = (b: Uint8Array | null) =>
  b === null ? null : Buffer.from(b).toString('hex')
const asManifest = (rows: ReturnType<typeof decodeBlock>) =>
  rows.map((r) => ({ ...r, payload: hex(r.payload) }))

describe('format 2 decoding matches the Go reader', () => {
  test('a standalone getBlock frame', () => {
    expect(asManifest(decodeBlockFrame(v2Block, d, undefined, 2))).toEqual(
      manifest.block.rows,
    )
  })

  test('a whole sealed segment, in memory and streamed', async () => {
    expect(readSealedHeader(v2Seal, 2)).toMatchObject({
      version: 2,
      blockCount: manifest.segment.blockCount,
      eventCount: 9,
    })
    expect(asManifest(decodeSegment(v2Seal, d, 2))).toEqual(
      manifest.segment.rows,
    )
    // Arbitrary chunk boundaries, like a network body.
    async function* chunks() {
      for (let i = 0; i < v2Seal.length; i += 7) yield v2Seal.subarray(i, i + 7)
    }
    const rows = []
    for await (const frame of streamSegmentFrames(chunks(), 2)) {
      rows.push(...decodeBlockFrame(frame, d, undefined, 2))
    }
    expect(asManifest(rows)).toEqual(manifest.segment.rows)
  })

  test('space dictionary, scope kind 8 and widened path lengths', () => {
    const rows = decodeBlockFrame(v2Block, d, undefined, 2)
    expect(rows.map((r) => r.space)).toEqual([
      '',
      'space:a',
      'space:b',
      'space:a',
      'space:b',
      'space:c',
      '',
      '',
      'space:a',
    ])
    // The same record path in the public namespace and two spaces.
    expect(
      new Set(rows.slice(0, 3).map((r) => r.collection + r.rkey)).size,
    ).toBe(1)
    expect(rows[4].kind).toBe(SegKind.Scope)
    expect(rows[5]).toMatchObject({ kind: SegKind.Scope, did: '' })
    expect(rows[8].collection.length).toBeGreaterThan(255)
    expect(rows[8].rkey.length).toBeGreaterThan(255)
  })

  test('an explicitly encoded empty format-2 block', () => {
    expect(decodeBlockFrame(v2Empty, d, undefined, 2)).toEqual([])
  })

  test('filter-aware decode skips rows without desyncing the columns', () => {
    const rows = decodeBlockFrame(
      v2Block,
      d,
      (_collection, _did, kind) => kind !== SegKind.Scope,
      2,
    )
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 7, 8, 9])
    expect(rows.at(-1)).toMatchObject({
      space: 'space:a',
      rev: '3l3qo2vuwbs2b',
    })
  })
})

describe('format agreement', () => {
  test('a public (format 1) context rejects format-2 artifacts', () => {
    expect(() => decodeBlockFrame(v2Block, d)).toThrow(
      /block format 2 does not match expected format 1/,
    )
    expect(() => readSealedHeader(v2Seal)).toThrow(MalformedError)
    expect(() => decodeSegment(v2Seal, d)).toThrow(MalformedError)
  })

  test('a format-2 context rejects format-1 artifacts', () => {
    expect(() => decodeBlockFrame(v1Block, d, undefined, 2)).toThrow(
      /block format 1 does not match expected format 2/,
    )
    expect(() => readSealedHeader(v1Seal, 2)).toThrow(MalformedError)
  })

  test('format 1 keeps decoding unchanged', () => {
    expect(decodeBlockFrame(v1Block, d)).toHaveLength(3)
    expect(decodeSegment(v1Seal, d)).toHaveLength(2)
    expect(decodeBlockFrame(v1Block, d).every((r) => r.space === '')).toBe(true)
  })

  test('the frames inside the sealed segment self-identify as format 2', () => {
    const h = readSealedHeader(v2Seal, 2)
    for (let i = 0; i < h.blockCount; i++) {
      const frame = readBlockFrame(v2Seal, h, i)
      expect(() => decodeBlockFrame(frame, d, undefined, 1)).toThrow(
        MalformedError,
      )
    }
  })
})

describe('malformed format-2 bodies are rejected', () => {
  const body = d.decompress(v2Block)
  const mutate = (fn: (b: Uint8Array, v: DataView) => void) => {
    const b = body.slice()
    fn(b, new DataView(b.buffer))
    return b
  }

  test('unknown block version or nonzero reserved field', () => {
    expect(() =>
      decodeBlock(
        mutate((_, v) => v.setUint16(4, 3, true)),
        undefined,
        2,
      ),
    ).toThrow(/unsupported block format version 3/)
    expect(() =>
      decodeBlock(
        mutate((_, v) => v.setUint16(6, 1, true)),
        undefined,
        2,
      ),
    ).toThrow(/reserved/)
  })

  test('dictionary count out of range', () => {
    expect(() =>
      decodeBlock(
        mutate((_, v) => v.setUint32(12, 0, true)),
        undefined,
        2,
      ),
    ).toThrow(/space dictionary count/)
    expect(() =>
      decodeBlock(
        mutate((_, v) => v.setUint32(12, 11, true)),
        undefined,
        2,
      ),
    ).toThrow(/space dictionary count/)
  })

  test('dictionary entry 0 must be the public namespace', () => {
    // Entry 0 is a u16 length at offset 16; give it a nonzero length.
    expect(() =>
      decodeBlock(
        mutate((_, v) => v.setUint16(16, 1, true)),
        undefined,
        2,
      ),
    ).toThrow(MalformedError)
  })

  test('a space id past the dictionary', () => {
    // Dictionary: '', 'space:a', 'space:b', 'space:c' (4 entries) after the
    // 16-byte header; the id column follows the 9*(8+8+8+1) fixed columns.
    let off = 16
    const v = new DataView(body.buffer, body.byteOffset, body.byteLength)
    for (let i = 0; i < 4; i++) off += 2 + v.getUint16(off, true)
    const idCol = off + 9 * 25
    expect(() =>
      decodeBlock(
        mutate((_, w) => w.setUint32(idCol, 99, true)),
        undefined,
        2,
      ),
    ).toThrow(/space id 99 out of range/)
  })

  test('scope kind in a format-1 block', () => {
    // golden_block row 0 kind byte: after count(4) + 3*(8+8+8).
    const v1 = d.decompress(v1Block).slice()
    v1[4 + 3 * 24] = SegKind.Scope
    expect(() => decodeBlock(v1)).toThrow(/invalid kind 8/)
  })

  test('a truncated escape header', () => {
    const frame = new Uint8Array(
      zstdCompressSync(Buffer.from([255, 255, 255, 255, 2])),
    )
    expect(() => decodeBlockFrame(frame, d, undefined, 2)).toThrow(
      MalformedError,
    )
  })
})
