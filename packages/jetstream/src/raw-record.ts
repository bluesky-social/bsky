import { type JsonValue, type TypedLexMap, jsonToLex } from '@atproto/lex'
import { decode as cborDecode } from '@atproto/lex-cbor'
import { MalformedError } from './errors.js'

/** Parsed wire JSON, NOT converted to lex values ({$link}/{$bytes} intact). */
export type RawRecordJson = JsonValue

/** Byte-exact DAG-CBOR, as archived. Snapshot/replay backfill yields this. */
export type RawRecordCbor = Uint8Array

/**
 * A record in either wire representation. The raw event types are generic
 * over this so each mode narrows to the arm it yields: live is JSON, archive
 * backfill is DAG-CBOR bytes.
 */
export type RawRecord = RawRecordJson | RawRecordCbor

// O(1) gate for a value that is already a lex value. @atproto/lex's
// isTypedLexMap deep-walks the record to learn these two facts; a prototype
// check answers both. Arrays, Uint8Array, and Cid instances all fail it.
function isTypedLexMapShallow(v: unknown): v is TypedLexMap {
  if (typeof v !== 'object' || v === null) return false
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return false
  const t = (v as { $type?: unknown }).$type
  return typeof t === 'string' && t.length > 0
}

/**
 * Converts a wire record (either representation) to the lex data model. CBOR
 * bytes decode directly; wire JSON converts {$link}/{$bytes}/blob refs to
 * Cid/Uint8Array/BlobRef. Strict mode additionally rejects non-integer
 * numbers and malformed special objects on the JSON arm, matching what
 * validateWire asserts elsewhere. Records are $type'd maps by contract, so
 * anything else throws rather than flowing on as garbage.
 */
export function parseRawRecord(
  record: RawRecord,
  opts?: { strict?: boolean },
): TypedLexMap {
  let lex: unknown
  try {
    lex =
      record instanceof Uint8Array
        ? cborDecode(record)
        : jsonToLex(record, { strict: opts?.strict === true })
  } catch (err) {
    // jsonToLex throws on a literal __proto__ key in either mode.
    throw new MalformedError('parse raw record', { cause: err })
  }
  if (!isTypedLexMapShallow(lex)) {
    const got =
      lex === null ? 'null' : Array.isArray(lex) ? 'array' : typeof lex
    throw new MalformedError(`record is not a $type'd object (got ${got})`)
  }
  return lex
}
