import {
  CBOR_DATA_CODEC,
  type DatetimeString,
  type InferOutput,
  SHA256_HASH_CODE,
  createCid,
  l,
} from '@atproto/lex'
import { decode as cborDecode } from '@atproto/lex-cbor'
import { MalformedError } from './errors.js'
import {
  type Account,
  type Identity,
  type RawCommit,
  type RawPutCommit,
  type RawSpacesEvent,
  type ScopeRepoRemoved,
  type ScopeSpaceDeleted,
  type Sync,
} from './event.js'
import { type RawRecordCbor } from './raw-record.js'
import { type Sha256 } from './runtime/interface.js'
import { type SegEvent } from './segment/block.js'
import { SegKind } from './segment/kind.js'

// Wire schemas for the segment boundary: the commit-row envelope (row string
// columns) and the CBOR payload shape for identity/account/sync. Types infer
// from these; validateWire safeValidates the same definitions.
const commitRowSchema = l.object({
  did: l.string({ format: 'did' }),
  collection: l.string({ format: 'nsid' }),
  rkey: l.string({ format: 'record-key' }),
  rev: l.string({ format: 'tid' }),
})
const rowDidSchema = l.object({
  did: l.string({ format: 'did' }),
})
const identityPayloadSchema = l.object({
  did: l.optional(l.string({ format: 'did' })),
  handle: l.optional(l.string({ format: 'handle' })),
  time: l.optional(l.string({ format: 'datetime' })),
})
const accountPayloadSchema = l.object({
  did: l.optional(l.string({ format: 'did' })),
  // Required by the upstream #account contract; rawEventFromSegment throws on
  // a missing value in every mode (see below).
  active: l.boolean(),
  status: l.optional(l.string()),
  time: l.optional(l.string({ format: 'datetime' })),
})
const syncPayloadSchema = l.object({
  did: l.optional(l.string({ format: 'did' })),
  rev: l.string({ format: 'tid' }), // required per spec; strict mode enforces
  time: l.optional(l.string({ format: 'datetime' })),
})
type WireIdentityPayload = InferOutput<typeof identityPayloadSchema>
type WireAccountPayload = Partial<InferOutput<typeof accountPayloadSchema>>
type WireSyncPayload = Partial<InferOutput<typeof syncPayloadSchema>>

/**
 * Synchronous CID for a DAG-CBOR record: SHA-256 the bytes and build a CIDv1
 * with the DAG-CBOR codec — byte-identical to the async cidForCbor, but
 * without the await.
 */
export function cidForRecord(payloadCbor: Uint8Array, sha256: Sha256): string {
  return createCid(
    CBOR_DATA_CODEC,
    SHA256_HASH_CODE,
    sha256(payloadCbor),
  ).toString()
}

/**
 * Builds a RawPutCommit from decoded row fields + raw record CBOR bytes. The
 * archive record IS the DAG-CBOR bytes. Only cid stays lazy: SHA-256 per put
 * commit is the largest per-event cost and most consumers never read it.
 * (This is also the optimistic brand boundary: wire strings become branded
 * commit fields here.)
 */
export function buildRawPutCommit(
  operation: 'create' | 'update',
  collection: string,
  rkey: string,
  rev: string,
  recordCbor: Uint8Array,
  sha256: Sha256,
): RawPutCommit<RawRecordCbor> {
  let cachedCid: string | undefined
  const commit = {
    operation,
    collection,
    rkey,
    rev,
    record: recordCbor,
  } as RawPutCommit<RawRecordCbor>
  Object.defineProperty(commit, 'cid', {
    enumerable: true,
    configurable: true,
    get(): string {
      return (cachedCid ??= cidForRecord(recordCbor, sha256))
    },
  })
  return commit
}

function operationOf(kind: SegKind): 'create' | 'update' | 'delete' {
  if (kind === SegKind.Update) return 'update'
  if (kind === SegKind.Delete) return 'delete'
  return 'create' // Create + CreateResync
}

/**
 * Formats archive micros as the RFC 3339 form the server emits on the live
 * wire (UTC, exactly six fractional digits), so archive and live events carry
 * the same `time` representation.
 */
export function microsToDatetime(us: number): DatetimeString {
  const seconds = Math.floor(us / 1_000_000)
  const frac = us - seconds * 1_000_000
  const iso = new Date(seconds * 1000).toISOString()
  return `${iso.slice(0, 19)}.${String(frac).padStart(6, '0')}Z` as DatetimeString
}

export interface DecodeEventOpts {
  sha256: Sha256
  validateWire?: boolean
}

/**
 * Upgrades one decoded segment row to a raw event. Format-1 rows (the only
 * rows a public archive serves) always come out as plain v2 RawEvents; only a
 * format-2 row can carry a space or be a scope marker.
 */
export function rawEventFromSegment(
  ev: SegEvent,
  opts: DecodeEventOpts,
): RawSpacesEvent<RawRecordCbor> {
  const { sha256, validateWire } = opts
  // Same display-time rule as the server's live encoder: an imported
  // indexedAt (nonzero) wins; otherwise the witnessed time.
  const timeUs = ev.indexedAt !== 0 ? ev.indexedAt : ev.witnessedAt
  const time = microsToDatetime(timeUs)
  if (ev.kind === SegKind.Scope) {
    return scopeEventFromSegment(ev, time, validateWire)
  }
  const base = { did: ev.did, seq: ev.seq, time }
  // `space` is added only when present: a public-namespace event has no key
  // at all, so public events are unchanged object-for-object (and public
  // rows allocate nothing extra).
  let scoped: typeof base & { space?: string } = base
  if (ev.space !== '') {
    // Identity and account are global account lifecycle events; a space on
    // one is not representable, and dropping it would widen its effect.
    if (ev.kind === SegKind.Identity || ev.kind === SegKind.Account) {
      throw new MalformedError(
        `global ${ev.kind === SegKind.Identity ? 'identity' : 'account'} row carries a space (seq=${ev.seq})`,
      )
    }
    scoped = { ...base, space: ev.space }
  }
  switch (ev.kind) {
    case SegKind.Create:
    case SegKind.Update:
    case SegKind.Delete:
    case SegKind.CreateResync: {
      if (validateWire) {
        const result = commitRowSchema.safeValidate(ev)
        if (!result.success) {
          throw new MalformedError(
            `wire validation failed (commit row, seq=${ev.seq})`,
            { cause: result.reason },
          )
        }
      }
      const op = operationOf(ev.kind)
      if (op === 'delete') {
        const commit: RawCommit<RawRecordCbor> = {
          operation: 'delete',
          collection: ev.collection,
          rkey: ev.rkey,
          rev: ev.rev,
        }
        return { ...scoped, kind: 'commit', commit }
      }
      if (!ev.payload) throw new MalformedError('put commit missing payload')
      const commit: RawCommit<RawRecordCbor> = buildRawPutCommit(
        op,
        ev.collection,
        ev.rkey,
        ev.rev,
        ev.payload,
        sha256,
      )
      return { ...scoped, kind: 'commit', commit }
    }
    case SegKind.Identity: {
      const m = (
        ev.payload?.length ? cborDecode(ev.payload) : {}
      ) as WireIdentityPayload
      if (validateWire) {
        validateRow(rowDidSchema, ev, 'identity row')
        validatePayload(identityPayloadSchema, m, ev.seq, 'identity payload')
      }
      const identity: Identity = {
        did: m.did ?? ev.did,
        handle: m.handle,
        time: m.time,
      }
      return { ...base, kind: 'identity', identity }
    }
    case SegKind.Account: {
      const m = (
        ev.payload?.length ? cborDecode(ev.payload) : {}
      ) as WireAccountPayload
      if (validateWire) {
        validateRow(rowDidSchema, ev, 'account row')
        validatePayload(accountPayloadSchema, m, ev.seq, 'account payload')
      }
      // `active` is the takedown/deactivation signal: defaulting a missing
      // value to false would fabricate "deactivated", so throw in every mode
      // (matching the live decoders).
      if (typeof m.active !== 'boolean') {
        throw new MalformedError(
          `account event missing required field active (did=${ev.did} seq=${ev.seq})`,
        )
      }
      const account: Account = {
        did: m.did ?? ev.did,
        active: m.active,
        status: m.status,
        time: m.time,
      }
      return { ...base, kind: 'account', account }
    }
    case SegKind.Sync: {
      const m = (
        ev.payload?.length ? cborDecode(ev.payload) : {}
      ) as WireSyncPayload
      if (validateWire) {
        validateRow(rowDidSchema, ev, 'sync row')
        validatePayload(syncPayloadSchema, m, ev.seq, 'sync payload')
      }
      const sync: Sync = {
        did: m.did ?? ev.did,
        // rev is required per spec; strict mode enforces it via the schema,
        // and default mode lets a garbage row flow like the live decoder does
        rev: m.rev ?? ('' as Sync['rev']),
        time: m.time,
      }
      return { ...scoped, kind: 'sync', sync }
    }
  }
  throw new MalformedError(`unknown segment kind ${String(ev.kind)}`)
}

const SCOPE_FIELDS = ['operation', 'cause', 'lastKnownRev']

/**
 * A scope row: the outer row carries space, the removed author (repoRemoved
 * only), seq and time; the payload is the canonical DAG-CBOR map of
 * operation and optional cause/lastKnownRev. Strict in every mode — this is
 * a lifecycle statement, so a misread would purge the wrong data.
 */
function scopeEventFromSegment(
  ev: SegEvent,
  time: DatetimeString,
  validateWire: boolean | undefined,
): RawSpacesEvent<RawRecordCbor> {
  const fail = (why: string): never => {
    throw new MalformedError(`invalid scope row (seq=${ev.seq}): ${why}`)
  }
  if (!ev.payload?.length) fail('missing payload')
  let m: unknown
  try {
    m = cborDecode(ev.payload!)
  } catch (err) {
    throw new MalformedError(`invalid scope row (seq=${ev.seq}): payload`, {
      cause: err,
    })
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    fail('payload is not a map')
  }
  const fields = m as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!SCOPE_FIELDS.includes(key)) fail(`unknown field ${key}`)
    if (typeof fields[key] !== 'string') fail(`${key} is not a string`)
  }
  const { operation, cause, lastKnownRev } = fields as {
    operation?: string
    cause?: string
    lastKnownRev?: string
  }
  if (ev.space === '') fail('missing space')
  if (ev.collection.length + ev.rkey.length + ev.rev.length !== 0) {
    fail('scope rows carry no record path or revision')
  }
  const extra = {
    ...(cause !== undefined ? { cause } : {}),
    ...(lastKnownRev !== undefined ? { lastKnownRev } : {}),
  }
  if (operation === 'repoRemoved') {
    if (ev.did.length === 0) fail('repoRemoved without did')
    if (validateWire) validateRow(rowDidSchema, ev, 'scope row')
    const scope: ScopeRepoRemoved = { operation, did: ev.did, ...extra }
    return {
      seq: ev.seq,
      time,
      space: ev.space,
      did: ev.did,
      kind: 'scope',
      scope,
    }
  }
  if (operation === 'spaceDeleted') {
    if (ev.did.length !== 0) fail('spaceDeleted with did')
    const scope: ScopeSpaceDeleted = { operation, ...extra }
    return { seq: ev.seq, time, space: ev.space, kind: 'scope', scope }
  }
  return fail(`unknown operation ${JSON.stringify(operation)}`)
}

function validateRow(
  schema: typeof rowDidSchema,
  ev: SegEvent,
  what: string,
): void {
  const result = schema.safeValidate(ev)
  if (!result.success) {
    throw new MalformedError(
      `wire validation failed (${what}, seq=${ev.seq})`,
      { cause: result.reason },
    )
  }
}

function validatePayload(
  schema: { safeValidate(v: unknown): { success: boolean; reason?: unknown } },
  payload: unknown,
  seq: number,
  what: string,
): void {
  const result = schema.safeValidate(payload)
  if (!result.success) {
    throw new MalformedError(`wire validation failed (${what}, seq=${seq})`, {
      cause: result.reason,
    })
  }
}
