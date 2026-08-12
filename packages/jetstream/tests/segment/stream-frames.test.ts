import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  readBlockFrame,
  readSealedHeader,
  streamSegmentFrames,
} from '../../src/segment/segment-reader.js'

// golden_seal.bin is a full sealed segment fixture (header + frames + footer).
const seal = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_seal.bin', import.meta.url)),
  ),
)

// Feed the whole buffer in arbitrary-sized chunks to exercise boundary handling.
async function* chunked(buf: Uint8Array, size: number) {
  for (let i = 0; i < buf.length; i += size)
    yield buf.subarray(i, Math.min(i + size, buf.length))
}
async function collect(src: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for await (const f of src) out.push(f)
  return out
}
const eq = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i])

describe('streamSegmentFrames', () => {
  it('yields exactly the frames readBlockFrame produces, in order', async () => {
    const h = readSealedHeader(seal)
    const expected: Uint8Array[] = []
    for (let i = 0; i < h.blockCount; i++)
      expected.push(readBlockFrame(seal, h, i))

    const streamed = await collect(streamSegmentFrames(chunked(seal, 7)))
    expect(streamed.length).toBe(h.blockCount)
    for (let i = 0; i < expected.length; i++) {
      expect(eq(streamed[i], expected[i]), `frame ${i} mismatch`).toBe(true)
    }
  })

  it('handles a chunk boundary splitting a length prefix and mid-frame', async () => {
    // size 1 forces every byte across a boundary
    const h = readSealedHeader(seal)
    const streamed = await collect(streamSegmentFrames(chunked(seal, 1)))
    expect(streamed.length).toBe(h.blockCount)
  })

  it('stops at footerOffset (does not read the trailing block index as frames)', async () => {
    const h = readSealedHeader(seal)
    const streamed = await collect(streamSegmentFrames(chunked(seal, 4096)))
    // exactly blockCount frames — the footer index after footerOffset is not parsed
    expect(streamed.length).toBe(h.blockCount)
  })

  it('handles a length prefix split across many 1-byte chunks with interleaved consumption', async () => {
    // Byte-exact frames when every chunk is 1 byte AND the consumer
    // interleaves (forces max buffering churn).
    async function* oneByte(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < seal.length; i++) {
        yield seal.subarray(i, i + 1)
      }
    }
    const h = readSealedHeader(seal)
    const expected: Uint8Array[] = []
    for (let i = 0; i < h.blockCount; i++)
      expected.push(readBlockFrame(seal, h, i))

    const frames: Uint8Array[] = []
    for await (const f of streamSegmentFrames(oneByte())) {
      frames.push(f)
      await new Promise((r) => setImmediate(r))
    }
    expect(frames.length).toBe(h.blockCount)
    for (let i = 0; i < expected.length; i++) {
      expect(eq(frames[i], expected[i]), `frame ${i} mismatch`).toBe(true)
    }
  })
})
