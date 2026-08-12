import { type RecordSchema } from '@atproto/lex'
import { type RawEventV1, type TypedCommit, type TypedEvent } from './event.js'

export function typedEventFromRaw(
  raw: RawEventV1,
  schemasByNsid: Map<string, RecordSchema>,
): TypedEvent {
  if (raw.kind !== 'commit') return raw
  // Delete first: DeleteCommit carries no `record`, so the put-commit handling
  // below only sees put commits.
  if (raw.commit.operation === 'delete') {
    return { ...raw, commit: raw.commit }
  }
  const rawCommit = raw.commit
  const { collection, rkey, rev, operation } = rawCommit
  // v1 put commit: the wire carried parsed JSON — there is no CBOR to decode.
  // cid is the wire string (read for free via the delegating getter below).
  const record: unknown = rawCommit.record
  let validationError: Error | undefined
  const schema = schemasByNsid.get(collection)
  if (schema) {
    const result = schema.safeValidate(record)
    if (!result.success) {
      validationError = new Error(
        `record validation failed for ${collection}`,
        {
          cause: result.reason,
        },
      )
    }
  }
  // cid delegates via a getter, mirroring the source package where the v2 raw
  // layer computes it lazily; v1's cid is a plain string, read for free
  // through the same getter. Keeping the delegation means the future v2 port
  // changes nothing here.
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
