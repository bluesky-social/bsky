import { type JsonValue, type TypedLexMap, jsonToLex } from '@atproto/lex'
import { MalformedError } from './errors.js'

/** Parsed wire JSON, NOT converted to lex values ({$link}/{$bytes} intact). */
export type RawRecordJson = JsonValue

/**
 * A record in its wire representation. One arm today; snapshot support adds a
 * byte-exact DAG-CBOR arm, which is why the raw event types are generic over
 * this.
 */
export type RawRecord = RawRecordJson

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
 * Converts a wire record to the lex data model: {$link} becomes a Cid,
 * {$bytes} a Uint8Array, blob refs a BlobRef. Strict mode additionally rejects
 * non-integer numbers and malformed special objects, matching what
 * validateWire asserts elsewhere. Records are $type'd maps by contract, so
 * anything else throws rather than flowing on as garbage.
 */
export function parseRawRecord(
  record: RawRecord,
  opts?: { strict?: boolean },
): TypedLexMap {
  let lex: unknown
  try {
    lex = jsonToLex(record, { strict: opts?.strict === true })
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
