import { type RecordSchema } from '@atproto/lex'
import {
  type RawEvent,
  type RawEventV1,
  type TypedCommit,
  type TypedEvent,
  type TypedEventV1,
} from './event.js'
import { type RawRecordJson, parseRawRecord } from './raw-record.js'

export function typedEventFromRaw(
  raw: RawEventV1,
  schemasByNsid: Map<string, RecordSchema>,
  opts?: { strict?: boolean },
): TypedEventV1
export function typedEventFromRaw(
  raw: RawEvent<RawRecordJson>,
  schemasByNsid: Map<string, RecordSchema>,
  opts?: { strict?: boolean },
): TypedEvent
export function typedEventFromRaw(
  raw: RawEventV1 | RawEvent<RawRecordJson>,
  schemasByNsid: Map<string, RecordSchema>,
  opts?: { strict?: boolean },
): TypedEventV1 | TypedEvent {
  if (raw.kind !== 'commit') return raw
  // Delete first: DeleteCommit carries no `record`, so the put-commit handling
  // below only sees put commits.
  if (raw.commit.operation === 'delete') {
    return { ...raw, commit: raw.commit }
  }
  const rawCommit = raw.commit
  const { collection, rkey, rev, operation } = rawCommit
  let record: unknown
  let validationError: Error | undefined
  // The raw record is wire-faithful; convert it to lex data here. A failure
  // surfaces the same way a decode failure always did.
  try {
    record = parseRawRecord(rawCommit.record, opts)
  } catch (err) {
    record = undefined
    validationError = err instanceof Error ? err : new Error(String(err))
  }
  const schema = schemasByNsid.get(collection)
  if (schema && validationError === undefined) {
    const result = schema.safeValidate(record)
    if (result.success) {
      // Adopt the validated value: lex-schema may apply defaults or coercions,
      // and returning the pre-coercion record would drop them.
      record = result.value
    } else {
      validationError = new Error(
        `record validation failed for ${collection}`,
        { cause: result.reason },
      )
    }
  }
  // cid delegates via a getter so the archive path's lazy hash is not forced
  // for every typed event. v2 live's cid is a plain string, free either way.
  const commit = {
    operation,
    collection,
    rkey,
    rev,
    record,
    ...(validationError ? { validationError } : {}),
  } as TypedCommit
  Object.defineProperty(commit, 'cid', {
    enumerable: true,
    configurable: true,
    get(): string {
      return rawCommit.cid
    },
  })
  // NOTE: spreading the raw EVENT ({ ...raw, commit }) is fine — commit is
  // replaced wholesale, so raw.commit.cid is never forced by the spread.
  return { ...raw, commit }
}
