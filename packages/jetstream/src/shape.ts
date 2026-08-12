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
 * schema validation for a validating schema filter and the event is skipped.
 * Distinguishable from transport errors via instanceof.
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
        // for both wires.
        const t = typedEventFromRaw(
          e as RawEvent<RawRecordJson>,
          schemasByNsid,
        ) as TypedEventV1 | TypedEvent
        if (skipInvalid(t, schemasByNsid, onError)) continue
        yield t
      }
    }
  }
}

// True (skip) only for put commits whose collection has a VALIDATING schema
// and whose record failed validation. Collections without a registered schema
// (string filters, validateRecord: false) flow through — exactly the pre-skip
// behavior.
function skipInvalid(
  t: TypedEventV1 | TypedEvent,
  schemasByNsid: Map<string, RecordSchema>,
  onError?: (err: Error) => void,
): boolean {
  if (t.kind !== 'commit' || t.commit.operation === 'delete') return false
  if (t.commit.validationError === undefined) return false
  if (!schemasByNsid.has(t.commit.collection)) return false
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
