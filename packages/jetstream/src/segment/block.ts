import {
  type DidString,
  type NsidString,
  type RecordKeyString,
  type TidString,
} from '@atproto/lex'
import { MalformedError } from '../errors.js'
import {
  type Decompressor,
  MAX_DECODED_BLOCK_BYTES,
} from '../runtime/interface.js'
import { type SegKind, isValidKind } from './kind.js'
import { ReadCursor } from './read-cursor.js'

/**
 * One decoded segment row. The string brands are optimistic — the segment
 * writer enforces formats, and validateWire re-checks them. Non-commit kinds
 * (identity/account/sync/scope) carry '' in collection/rkey/rev, so the
 * brands are trustworthy only on commit rows; a spaceDeleted scope row also
 * carries '' in did.
 *
 * Timestamps are unix microseconds: witnessedAt is when jetstream first saw
 * the event (immutable); indexedAt is the display timestamp, 0 unless an
 * operator imported one, and it wins when nonzero (see the server's
 * segment/event.go DisplayTime).
 *
 * `space` is the row's SpaceRef namespace from a format-2 block's space
 * dictionary; '' is the public namespace (always '' in format 1).
 */
export interface SegEvent {
  seq: number
  witnessedAt: number
  indexedAt: number
  kind: SegKind
  space: string
  did: DidString
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  payload: Uint8Array | null
}

/** Segment and raw-block format versions this decoder understands. */
export type FormatVersion = 1 | 2

export const MAX_BLOCK_EVENTS = 1 << 18 // matches Go maxBlockEventsLimit

const FIXED_PER_EVENT_V1 = 8 + 8 + 8 + 1 + 1 + 2 + 1 + 1 + 4
// v2 adds a u32 space ID per row and widens collection/rkey lengths to u16.
const FIXED_PER_EVENT_V2 = 8 + 8 + 8 + 1 + 4 + 2 + 2 + 2 + 1 + 4
// Format 2 begins with the impossible v1 event count, so a raw frame
// identifies its own format.
const BLOCK_VERSION_ESCAPE = 0xffffffff
const td = new TextDecoder()

export type RowKeep = (
  collection: string,
  did: string,
  kind: SegKind,
  seq: number,
) => boolean

/**
 * The self-identified format of a decompressed block body: format 2 starts
 * with the 0xffffffff escape, a u16 version of 2 and a zero u16 reserved
 * field; anything else is format 1.
 */
export function blockBodyFormat(buf: Uint8Array): FormatVersion {
  if (buf.length < 4) throw new MalformedError('block shorter than header')
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (view.getUint32(0, true) !== BLOCK_VERSION_ESCAPE) return 1
  if (buf.length < 8) throw new MalformedError('block shorter than header')
  const version = view.getUint16(4, true)
  if (version !== 2) {
    throw new MalformedError(`unsupported block format version ${version}`)
  }
  if (view.getUint16(6, true) !== 0) {
    throw new MalformedError('nonzero reserved field in format-2 block')
  }
  return 2
}

/**
 * Decodes a decompressed columnar block. With a keep predicate, rejected rows
 * are skipped without string-decoding or copying their payloads — but every
 * row must still advance the cursor by its recorded lengths or the column
 * walk desyncs.
 *
 * `expectedFormat` is the format the caller's context requires (the plan
 * entry, response header and segment header agree on it). A block in any
 * other format is rejected rather than decoded: the default 1 keeps a public
 * consumer from ever receiving format-2 rows.
 */
export function decodeBlock(
  buf: Uint8Array,
  keep?: RowKeep,
  expectedFormat: FormatVersion = 1,
): SegEvent[] {
  const format = blockBodyFormat(buf)
  if (format !== expectedFormat) {
    throw new MalformedError(
      `block format ${format} does not match expected format ${expectedFormat}`,
    )
  }
  const c = new ReadCursor(buf)
  let spaces: string[] | undefined
  let n: number
  if (format === 2) {
    c.take(8) // escape, version, reserved (checked above)
    if (c.bytesLeft() < 8) throw new MalformedError('block shorter than header')
    n = c.u32le()
    if (n > MAX_BLOCK_EVENTS) throw new MalformedError('event_count too large')
    const count = c.u32le()
    // ID 0 is always the public namespace, so a dictionary is never empty and
    // never larger than one entry per row plus that public entry.
    if (count === 0 || count > n + 1 || count * 2 > c.bytesLeft()) {
      throw new MalformedError(`invalid space dictionary count ${count}`)
    }
    spaces = new Array<string>(count)
    const seen = new Set<string>()
    for (let i = 0; i < count; i++) {
      const space = td.decode(c.take(c.u16le()))
      if (seen.has(space) || (i === 0 && space !== '')) {
        throw new MalformedError('invalid space dictionary entry')
      }
      seen.add(space)
      spaces[i] = space
    }
  } else {
    n = c.u32le()
    if (n > MAX_BLOCK_EVENTS) throw new MalformedError('event_count too large')
  }
  const fixed = format === 2 ? FIXED_PER_EVENT_V2 : FIXED_PER_EVENT_V1
  if (c.bytesLeft() < n * fixed) {
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
  const witnessedAts = new Array<number>(n)
  for (let i = 0; i < n; i++) witnessedAts[i] = c.i64leAsNumber()
  const indexedAts = new Array<number>(n)
  for (let i = 0; i < n; i++) indexedAts[i] = c.i64leAsNumber()
  const kinds = new Array<SegKind>(n)
  for (let i = 0; i < n; i++) {
    const k = c.u8()
    if (!isValidKind(k, format)) throw new MalformedError(`invalid kind ${k}`)
    kinds[i] = k as SegKind
  }
  const rowSpaces = new Array<string>(n)
  if (spaces) {
    for (let i = 0; i < n; i++) {
      const id = c.u32le()
      if (id >= spaces.length) {
        throw new MalformedError(`space id ${id} out of range`)
      }
      rowSpaces[i] = spaces[id]
    }
  } else {
    rowSpaces.fill('')
  }

  // Format 2 widens the collection and rkey lengths to u16.
  const pathLen = format === 2 ? () => c.u16le() : () => c.u8()
  const collLen = new Array<number>(n)
  for (let i = 0; i < n; i++) collLen[i] = pathLen()
  const didLen = new Array<number>(n)
  for (let i = 0; i < n; i++) didLen[i] = c.u16le()
  const rkeyLen = new Array<number>(n)
  for (let i = 0; i < n; i++) rkeyLen[i] = pathLen()
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
    kept[i] = keep ? keep(collections[i], dids[i], kinds[i], seqs[i]) : true
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
      witnessedAt: witnessedAts[i],
      indexedAt: indexedAts[i],
      kind: kinds[i],
      space: rowSpaces[i],
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
  expectedFormat: FormatVersion = 1,
): SegEvent[] {
  return decodeBlock(
    d.decompress(frame, MAX_DECODED_BLOCK_BYTES),
    keep,
    expectedFormat,
  )
}
