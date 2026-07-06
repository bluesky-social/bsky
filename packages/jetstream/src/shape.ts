// src/shape.ts
import { type RecordSchema } from '@atproto/lex-schema'
import { typedEventFromRaw } from './decode-typed.js'
import { type EventBatch, type RawEventV1, type TypedEvent } from './event.js'

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

export async function* shape(
  src: AsyncIterable<EventBatch<RawEventV1>>,
  flags: ShapeFlags,
  schemasByNsid: Map<string, RecordSchema>,
  onError?: (err: Error) => void,
): AsyncGenerator<RawEventV1 | TypedEvent> {
  const raw = flags.raw === true
  for await (const batch of src) {
    if (raw) {
      for (const e of batch.events) yield e
    } else {
      for (const e of batch.events) {
        const t = typedEventFromRaw(e, schemasByNsid)
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
  t: TypedEvent,
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
