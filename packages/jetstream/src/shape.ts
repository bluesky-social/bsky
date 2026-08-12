import { type RecordSchema } from '@atproto/lex'
import { typedEventFromRaw } from './decode-typed.js'
import {
  type EventBatch,
  type RawEvent,
  type RawEventV1,
  type TypedEvent,
  type TypedEventV1,
} from './event.js'
import { type RawRecordJson } from './raw-record.js'

/**
 * Reported through the per-call onError when a put commit's record fails
 * conversion (regardless of collection) or fails schema validation for a
 * validating schema filter, and the event is skipped. Distinguishable from
 * transport errors via instanceof.
 */
export class RecordValidationError extends Error {
  readonly did: string
  readonly collection: string
  readonly rkey: string
  readonly seq: number
  constructor(opts: {
    did: string
    collection: string
    rkey: string
    seq: number
    cause: unknown
  }) {
    super(
      `record validation failed for ${opts.collection} (at://${opts.did}/${opts.collection}/${opts.rkey} seq=${opts.seq})`,
      { cause: opts.cause },
    )
    this.name = 'RecordValidationError'
    this.did = opts.did
    this.collection = opts.collection
    this.rkey = opts.rkey
    this.seq = opts.seq
  }
}

export interface ShapeFlags {
  raw?: boolean
  validateWire?: boolean
}

type AnyRaw = RawEventV1 | RawEvent<RawRecordJson>

export async function* shape(
  src: AsyncIterable<EventBatch<AnyRaw>>,
  flags: ShapeFlags,
  schemasByNsid: Map<string, RecordSchema>,
  onError?: (err: Error) => void,
): AsyncGenerator<AnyRaw | TypedEventV1 | TypedEvent> {
  const raw = flags.raw === true
  for await (const batch of src) {
    if (raw) {
      for (const e of batch.events) yield e
    } else {
      for (const e of batch.events) {
        // The overloads exist for callers; this internal fan-out runs one body
        // for both wires. Only the input-side cast is needed — the v2
        // overload's result (TypedEvent) already sits inside the declared
        // union (TypedEventV1 | TypedEvent), so a result-side cast would be a
        // no-op that could silently swallow a future mismatch.
        const t = typedEventFromRaw(
          e as RawEvent<RawRecordJson>,
          schemasByNsid,
          {
            strict: flags.validateWire === true,
          },
        )
        if (skipInvalid(t, schemasByNsid, onError)) continue
        yield t
      }
    }
  }
}

// Skip (and report) a put commit whose record is unusable. Two distinct
// failure shapes reach here, both carrying `validationError`:
//   - conversion failed: `record` is undefined, REGARDLESS of collection —
//     the static type (TypedLexMap, non-optional) promises a record is
//     present, so delivering undefined would be data corruption. Always
//     skip and report.
//   - schema validation failed: `record` is defined (the converted value)
//     but didn't validate. Skipped only for collections with a VALIDATING
//     schema; collections without one (string filters, validateRecord:
//     false) flow through — exactly the pre-skip behavior.
function skipInvalid(
  t: TypedEventV1 | TypedEvent,
  schemasByNsid: Map<string, RecordSchema>,
  onError?: (err: Error) => void,
): boolean {
  if (t.kind !== 'commit' || t.commit.operation === 'delete') return false
  if (t.commit.validationError === undefined) return false
  if (t.commit.record && !schemasByNsid.has(t.commit.collection)) return false
  onError?.(
    new RecordValidationError({
      did: t.did,
      collection: t.commit.collection,
      rkey: t.commit.rkey,
      seq: t.seq,
      cause: t.commit.validationError,
    }),
  )
  return true
}
