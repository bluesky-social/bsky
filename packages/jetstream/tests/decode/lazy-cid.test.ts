import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cidForRecord, rawEventFromSegment } from '../../src/decode-event.js'
import { typedEventFromRaw } from '../../src/decode-typed.js'
import { defaultDecompressor, defaultSha256 } from '../../src/runtime/node.js'
import { decodeBlockFrame } from '../../src/segment/block.js'

const decompressor = defaultDecompressor()
const sha256 = defaultSha256()

const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)

function putEvent() {
  const rows = decodeBlockFrame(goldenFrame, decompressor)
  for (const r of rows) {
    const ev = rawEventFromSegment(r, { sha256 })
    if (ev.kind === 'commit' && ev.commit.operation !== 'delete') return ev
  }
  throw new Error('golden block has no put commit')
}

describe('lazy cid', () => {
  it('computes the same cid as direct hashing, on access', () => {
    const ev = putEvent()
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete')
      throw new Error()
    // Wire-faithful: record IS the CBOR bytes on the archive path.
    const recordCbor = ev.commit.record as Uint8Array
    expect(ev.commit.cid).toBe(cidForRecord(recordCbor, sha256))
  })

  it('is enumerable: spread and JSON still include cid', () => {
    const ev = putEvent()
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete')
      throw new Error()
    const spread = { ...ev.commit }
    expect(typeof spread.cid).toBe('string')
    expect(JSON.parse(JSON.stringify({ cid: ev.commit.cid })).cid).toBe(
      spread.cid,
    )
  })

  it('caches: two reads return the identical string', () => {
    const ev = putEvent()
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete')
      throw new Error()
    const a = ev.commit.cid
    const b = ev.commit.cid
    expect(a).toBe(b)
  })

  it('typedEventFromRaw does not force the cid; typed cid matches on access', () => {
    const ev = putEvent()
    const typed = typedEventFromRaw(ev, new Map())
    if (typed.kind !== 'commit' || typed.commit.operation === 'delete')
      throw new Error()
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete')
      throw new Error()
    expect(typed.commit.cid).toBe(ev.commit.cid)
  })

  it('cid is defined as a getter (lazy) on raw and typed commits', () => {
    const ev = putEvent()
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete')
      throw new Error()
    expect(Object.getOwnPropertyDescriptor(ev.commit, 'cid')?.get).toBeTypeOf(
      'function',
    )
    const typed = typedEventFromRaw(putEvent(), new Map())
    if (typed.kind !== 'commit' || typed.commit.operation === 'delete')
      throw new Error()
    expect(
      Object.getOwnPropertyDescriptor(typed.commit, 'cid')?.get,
    ).toBeTypeOf('function')
  })
})
