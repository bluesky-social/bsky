import { MalformedError } from '../errors.js'
import {
  type SegHeader,
  readSealedHeader,
  RESERVED_HEADER_BYTES,
} from './header.js'
import { type SegEvent, decodeBlockFrame } from './block.js'
import { type Decompressor } from './decompressor.js'

const BLOCK_INDEX_ENTRY_SIZE = 52
const LENGTH_PREFIX = 8

export { readSealedHeader, RESERVED_HEADER_BYTES }

/** Random-access read of one compressed block frame via the footer index. */
export function readBlockFrame(
  buf: Uint8Array,
  h: SegHeader,
  idx: number,
): Uint8Array {
  if (idx < 0 || idx >= h.blockCount) {
    throw new MalformedError(
      `block index ${idx} out of range (${h.blockCount})`,
    )
  }
  if (h.footerOffset < RESERVED_HEADER_BYTES) {
    throw new MalformedError('footer offset inside reserved header')
  }
  if (h.blockIndexOffset !== h.footerOffset) {
    throw new MalformedError('block index offset != footer offset')
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const entryOff = h.blockIndexOffset + idx * BLOCK_INDEX_ENTRY_SIZE
  if (entryOff + BLOCK_INDEX_ENTRY_SIZE > buf.length) {
    throw new MalformedError('block index entry out of range')
  }
  const frameOff = Number(view.getBigUint64(entryOff, true))
  const compressedSize = view.getUint32(entryOff + 8, true)

  // The frame range must lie within [reserved header, footer).
  if (
    frameOff < RESERVED_HEADER_BYTES ||
    frameOff > h.footerOffset - LENGTH_PREFIX ||
    compressedSize > h.footerOffset - frameOff - LENGTH_PREFIX
  ) {
    throw new MalformedError(`block ${idx} frame range invalid`)
  }
  const start = frameOff + LENGTH_PREFIX
  return buf.subarray(start, start + compressedSize)
}

/**
 * Streams a sealed segment's compressed block frames (no length prefix) in
 * file order, tolerating arbitrary chunk boundaries. Walks
 * [u64 LE length][frame] pairs from after the 256-byte header up to
 * footerOffset; the trailing block-index footer is not parsed.
 */
export async function* streamSegmentFrames(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  // Chunk-list buffering: appending is O(1) and frame extraction copies
  // exactly the frame's bytes. Eagerly concatenating the accumulation would
  // be O(n^2) under backpressure, and retaining consumed chunks would pin
  // their backing ArrayBuffers.
  const chunks: Uint8Array[] = []
  let pending = 0 // total unconsumed bytes across chunks (minus offset)
  let offset = 0 // consumed bytes within chunks[0]
  const iter = source[Symbol.asyncIterator]()

  const append = (chunk: Uint8Array) => {
    chunks.push(chunk.slice()) // own the bytes; the source may reuse its buffer
    pending += chunk.length
  }

  // Pull until at least n bytes are buffered, or the source ends.
  const ensure = async (n: number): Promise<boolean> => {
    while (pending < n) {
      const { value, done } = await iter.next()
      if (done) return false
      if (value && value.length) append(value)
    }
    return true
  }

  // Copy exactly len bytes out of the chunk list into one new Uint8Array.
  const takeBytes = (len: number): Uint8Array => {
    const out = new Uint8Array(len)
    let written = 0
    while (written < len) {
      const head = chunks[0]
      const avail = head.length - offset
      const take = Math.min(avail, len - written)
      out.set(head.subarray(offset, offset + take), written)
      written += take
      offset += take
      if (offset === head.length) {
        chunks.shift()
        offset = 0
      }
    }
    pending -= len
    return out
  }

  if (!(await ensure(RESERVED_HEADER_BYTES))) {
    throw new MalformedError('segment ended before header')
  }
  const headerBytes = takeBytes(RESERVED_HEADER_BYTES)
  const h = readSealedHeader(headerBytes)
  let consumed = RESERVED_HEADER_BYTES

  let emitted = 0
  while (consumed < h.footerOffset && emitted < h.blockCount) {
    if (!(await ensure(LENGTH_PREFIX))) {
      throw new MalformedError('segment ended before frame length')
    }
    const prefix = takeBytes(LENGTH_PREFIX)
    const frameLen = Number(
      new DataView(prefix.buffer, prefix.byteOffset, 8).getBigUint64(0, true),
    )
    if (frameLen < 0 || consumed + LENGTH_PREFIX + frameLen > h.footerOffset) {
      throw new MalformedError(
        `frame ${emitted} length ${frameLen} exceeds footer`,
      )
    }
    if (!(await ensure(frameLen))) {
      throw new MalformedError(`segment ended mid-frame ${emitted}`)
    }
    const frame = takeBytes(frameLen)
    consumed += LENGTH_PREFIX + frameLen
    emitted++
    yield frame
  }
  if (emitted !== h.blockCount) {
    throw new MalformedError(`expected ${h.blockCount} frames, got ${emitted}`)
  }
}

/** Decodes a whole in-memory sealed segment via the footer index. */
export function decodeSegment(buf: Uint8Array, d: Decompressor): SegEvent[] {
  const h = readSealedHeader(buf)
  const out: SegEvent[] = []
  for (let i = 0; i < h.blockCount; i++) {
    const frame = readBlockFrame(buf, h, i)
    for (const ev of decodeBlockFrame(frame, d)) out.push(ev)
  }
  return out
}
