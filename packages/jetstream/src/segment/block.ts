import {
  type DidString,
  type NsidString,
  type RecordKeyString,
  type TidString,
} from '@atproto/lex'
import { MalformedError } from '../errors.js'
import { type Decompressor, MAX_DECODED_BLOCK_BYTES } from './decompressor.js'
import { type SegKind, isValidKind } from './kind.js'
import { ReadCursor } from './read-cursor.js'

/**
 * One decoded segment row. The string brands are optimistic — the segment
 * writer enforces formats, and validateWire re-checks them. Non-commit kinds
 * (identity/account/sync) carry '' in collection/rkey/rev, so the brands are
 * trustworthy only on commit rows.
 */
export interface SegEvent {
  seq: number
  indexedAt: number
  renderedAt: number
  kind: SegKind
  did: DidString
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  payload: Uint8Array | null
}

export const MAX_BLOCK_EVENTS = 1 << 18 // matches Go maxBlockEventsLimit

const FIXED_PER_EVENT = 8 + 8 + 8 + 1 + 1 + 2 + 1 + 1 + 4
const td = new TextDecoder()

export type RowKeep = (
  collection: string,
  did: string,
  kind: SegKind,
) => boolean

/**
 * Decodes a decompressed columnar block. With a keep predicate, rejected rows
 * are skipped without string-decoding or copying their payloads — but every
 * row must still advance the cursor by its recorded lengths or the column
 * walk desyncs.
 */
export function decodeBlock(buf: Uint8Array, keep?: RowKeep): SegEvent[] {
  const c = new ReadCursor(buf)
  const n = c.u32le()
  if (n > MAX_BLOCK_EVENTS) throw new MalformedError('event_count too large')
  if (c.bytesLeft() < n * FIXED_PER_EVENT) {
    throw new MalformedError('block shorter than fixed columns')
  }
  if (n === 0) {
    if (c.bytesLeft() !== 0)
      throw new MalformedError('trailing bytes after empty block')
    return []
  }

  // Fixed columns in spec order, decoded for all rows (cheap numerics).
  const seqs = new Array<number>(n)
  for (let i = 0; i < n; i++) seqs[i] = c.u64leAsNumber()
  const indexedAts = new Array<number>(n)
  for (let i = 0; i < n; i++) indexedAts[i] = c.i64leAsNumber()
  const renderedAts = new Array<number>(n)
  for (let i = 0; i < n; i++) renderedAts[i] = c.i64leAsNumber()
  const kinds = new Array<SegKind>(n)
  for (let i = 0; i < n; i++) {
    const k = c.u8()
    if (!isValidKind(k)) throw new MalformedError(`invalid kind ${k}`)
    kinds[i] = k as SegKind
  }

  const collLen = new Array<number>(n)
  for (let i = 0; i < n; i++) collLen[i] = c.u8()
  const didLen = new Array<number>(n)
  for (let i = 0; i < n; i++) didLen[i] = c.u16le()
  const rkeyLen = new Array<number>(n)
  for (let i = 0; i < n; i++) rkeyLen[i] = c.u8()
  const revLen = new Array<number>(n)
  for (let i = 0; i < n; i++) revLen[i] = c.u8()
  const payLen = new Array<number>(n)
  for (let i = 0; i < n; i++) payLen[i] = c.u32le()

  // Collection and did are decoded for every row (the predicate needs them).
  const collections = new Array<string>(n)
  for (let i = 0; i < n; i++) collections[i] = td.decode(c.take(collLen[i]))
  const dids = new Array<string>(n)
  for (let i = 0; i < n; i++) dids[i] = td.decode(c.take(didLen[i]))

  const kept = new Array<boolean>(n)
  let keptCount = 0
  for (let i = 0; i < n; i++) {
    kept[i] = keep ? keep(collections[i], dids[i], kinds[i]) : true
    if (kept[i]) keptCount++
  }

  const rows: SegEvent[] = new Array(keptCount)
  let out = 0
  const rkeys = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const b = c.take(rkeyLen[i])
    if (kept[i]) rkeys[i] = td.decode(b)
  }
  const revs = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const b = c.take(revLen[i])
    if (kept[i]) revs[i] = td.decode(b)
  }
  for (let i = 0; i < n; i++) {
    const pl = payLen[i]
    const b = pl > 0 ? c.take(pl) : null
    if (!kept[i]) continue
    rows[out++] = {
      seq: seqs[i],
      indexedAt: indexedAts[i],
      renderedAt: renderedAts[i],
      kind: kinds[i],
      did: dids[i],
      collection: collections[i],
      rkey: rkeys[i],
      rev: revs[i],
      // Copied out — the caller may retain the payload past the buffer's life.
      payload: b ? b.slice() : null,
    } as SegEvent
  }

  if (c.bytesLeft() !== 0)
    throw new MalformedError('trailing bytes after block')
  return rows
}

export function decodeBlockFrame(
  frame: Uint8Array,
  d: Decompressor,
  keep?: RowKeep,
): SegEvent[] {
  return decodeBlock(d.decompress(frame, MAX_DECODED_BLOCK_BYTES), keep)
}
