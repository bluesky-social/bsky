import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type RowKeep, decodeBlockFrame } from '../../src/segment/block.js'
import { nodeDecompressor } from '../../src/segment/decompressor.js'
import { isCommitKind } from '../../src/segment/kind.js'

const d = await nodeDecompressor()

const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

const predicates: Record<string, RowKeep> = {
  all: () => true,
  none: (_c, _d, kind) => !isCommitKind(kind), // commits rejected; others bypass
  posts: (c, _d, kind) => !isCommitKind(kind) || c === 'app.bsky.feed.post',
  byDid: (_c, did) => did.length % 2 === 0, // arbitrary did-based predicate
}

describe('decodeBlock keep-predicate equivalence', () => {
  for (const [name, keep] of Object.entries(predicates)) {
    it(`filtered decode ≡ decode-then-filter (${name})`, () => {
      const full = decodeBlockFrame(goldenFrame, d)
      const expected = full.filter((r) => keep(r.collection, r.did, r.kind))
      const filtered = decodeBlockFrame(goldenFrame, d, keep)
      expect(filtered).toEqual(expected)
    })
  }

  it('no predicate ≡ keep-all', () => {
    expect(decodeBlockFrame(goldenFrame, d)).toEqual(
      decodeBlockFrame(goldenFrame, d, () => true),
    )
  })
})
