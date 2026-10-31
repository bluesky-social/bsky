import { type InferOutput, l } from '@atproto/lex'
import { MalformedError, XrpcSubscriptionError } from '../errors.js'
import {
  type Account,
  type Identity,
  type JetstreamProgress,
  type RawCommit,
  type RawEvent,
  type RawPutCommit,
  type RawSpacesEvent,
  type Sync,
} from '../event.js'
import { type RawRecordJson } from '../raw-record.js'

export const SKIP_FRAME = Symbol('jetstream.skipFrame')

const NSID = 'network.bsky.jetstream.subscribeEvents'
const COMMIT = `${NSID}#commit`
const IDENTITY = `${NSID}#identity`
const ACCOUNT = `${NSID}#account`
const SYNC = `${NSID}#sync`
const INFO = `${NSID}#info`
const SCOPE = `${NSID}#scope`
const PROGRESS = `${NSID}#progress`

/**
 * A seq-less advisory (today only `OutdatedCursor`, sent when a
 * timestamp-domain cursor was clamped). Kept distinct from SKIP_FRAME so
 * liveEvents can report it instead of discarding it silently.
 */
export interface LiveInfoFrame {
  info: { name: string; message?: string }
}

/** A Spaces `#progress` coverage message (only with progress=true). */
export interface LiveProgressFrame {
  progress: JetstreamProgress
}

// The v2 wire contract, declared once: payload types are inferred from these
// schemas, the `as WirePayload` cast below is the single optimistic boundary,
// and validateWire safeValidates the SAME schemas. These describe the
// parsed-JSON shape, so `record` and `blocks` stay unknown() — conversion to
// lex values belongs to the typed layer.
const wireEnvelopeFields = {
  seq: l.integer(),
  did: l.string({ format: 'did' }),
  time: l.string({ format: 'datetime' }),
}

// One object with optionals rather than a put/delete union: the lexicon models
// operation as knownValues and marks record/cid absent for deletes. No
// recordCbor — it is not on the v2 wire; lex objects are open, so an older
// server's stray field is ignored rather than copied onto our commit.
const wireCommitPayload = l.object({
  ...wireEnvelopeFields,
  $type: l.literal(COMMIT),
  rev: l.string({ format: 'tid' }),
  operation: l.union([
    l.literal('create'),
    l.literal('update'),
    l.literal('delete'),
  ]),
  collection: l.string({ format: 'nsid' }),
  rkey: l.string({ format: 'record-key' }),
  cid: l.optional(l.string({ format: 'cid' })),
  record: l.optional(l.unknown()),
})

// identity/account/sync wrap the relay's subscribeRepos event verbatim. The
// wrapped seq/time are the relay's, so only the envelope's become our cursor.
const wireIdentityPayload = l.object({
  ...wireEnvelopeFields,
  $type: l.literal(IDENTITY),
  identity: l.object({
    seq: l.optional(l.integer()),
    did: l.string({ format: 'did' }),
    handle: l.optional(l.string({ format: 'handle' })),
    time: l.optional(l.string({ format: 'datetime' })),
  }),
})

const wireAccountPayload = l.object({
  ...wireEnvelopeFields,
  $type: l.literal(ACCOUNT),
  account: l.object({
    seq: l.optional(l.integer()),
    did: l.string({ format: 'did' }),
    // Required on subscribeRepos#account: "active" vs "inactive" is the
    // takedown/deactivation signal, so a missing value must throw rather than
    // default to false (which downstream would read as "deactivated").
    active: l.boolean(),
    status: l.optional(l.string()),
    time: l.optional(l.string({ format: 'datetime' })),
  }),
})

const wireSyncPayload = l.object({
  ...wireEnvelopeFields,
  $type: l.literal(SYNC),
  sync: l.object({
    seq: l.optional(l.integer()),
    did: l.string({ format: 'did' }),
    rev: l.string({ format: 'tid' }),
    time: l.optional(l.string({ format: 'datetime' })),
    blocks: l.optional(l.unknown()), // accepted and discarded
  }),
})

const wirePayload = l.union([
  wireCommitPayload,
  wireIdentityPayload,
  wireAccountPayload,
  wireSyncPayload,
])
type WirePayload = InferOutput<typeof wirePayload>
type WireCommitPayload = InferOutput<typeof wireCommitPayload>

// The Spaces additions (protocolVersion=2): an optional SpaceRef namespace on
// #commit and #sync, the #scope lifecycle marker, and #progress coverage.
// Validated in every mode — scope markers purge data and progress certifies
// coverage, so neither may be read optimistically.
const wireSpace = l.optional(l.string({ minLength: 1 }))
const wireScopePayload = l.object({
  $type: l.literal(SCOPE),
  seq: l.integer({ minimum: 1 }),
  time: l.string({ format: 'datetime' }),
  space: l.string({ minLength: 1 }),
  operation: l.union([l.literal('repoRemoved'), l.literal('spaceDeleted')]),
  did: l.optional(l.string({ format: 'did' })),
  cause: l.optional(l.string()),
  lastKnownRev: l.optional(l.string()),
})
const wireProgressPayload = l.object({
  $type: l.literal(PROGRESS),
  throughSeq: l.integer({ minimum: 0 }),
  caughtUp: l.boolean(),
})

export interface DecodeLiveOpts {
  validateWire?: boolean
  /** Decode the Spaces additions; without it they are skipped as unknown. */
  spaces?: boolean
  /** Deliver #progress frames (only when the stream requested them). */
  progress?: boolean
}
// Pre-discrimination peek: error frames, #info advisories, and unknown types
// are handled before the WirePayload cast (l.union rejects unknown
// discriminants by design).
interface PeekFrame {
  $type?: unknown
  error?: unknown
  message?: unknown
  payload?: { $type?: unknown; name?: unknown; message?: unknown }
}

const td = new TextDecoder()

export function decodeLiveFrame(
  data: Uint8Array | string,
  validateWire?: boolean,
): RawEvent<RawRecordJson> | LiveInfoFrame | typeof SKIP_FRAME
export function decodeLiveFrame(
  data: Uint8Array | string,
  validateWire: boolean | undefined,
  opts: DecodeLiveOpts,
):
  | RawSpacesEvent<RawRecordJson>
  | LiveInfoFrame
  | LiveProgressFrame
  | typeof SKIP_FRAME
export function decodeLiveFrame(
  data: Uint8Array | string,
  validateWire?: boolean,
  opts?: DecodeLiveOpts,
):
  | RawSpacesEvent<RawRecordJson>
  | LiveInfoFrame
  | LiveProgressFrame
  | typeof SKIP_FRAME {
  const spaces = opts?.spaces === true
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof data === 'string' ? data : td.decode(data))
  } catch (err) {
    throw new MalformedError('decode live frame', { cause: err })
  }
  // `null` is valid JSON but not a frame: without this guard, `peek.$type`
  // below throws TypeError instead of MalformedError. Other non-object JSON
  // (numbers, strings, arrays) reads `$type` as undefined and correctly falls
  // out as SKIP_FRAME further down, so only null needs the explicit guard.
  if (parsed === null) {
    throw new MalformedError('live frame is null')
  }

  const peek = parsed as PeekFrame
  if (peek.$type === 'error') {
    const code = String(peek.error ?? 'unknown')
    const message = peek.message == null ? '' : String(peek.message)
    throw new XrpcSubscriptionError(code, message)
  }
  if (peek.$type !== 'message') return SKIP_FRAME

  const payloadType = peek.payload?.$type
  if (payloadType === INFO) {
    // Legitimate wire, not malformed — accepted even in strict mode.
    const name = peek.payload?.name
    const message = peek.payload?.message
    return {
      info: {
        name: name == null ? 'unknown' : String(name),
        message: message == null ? undefined : String(message),
      },
    }
  }
  if (spaces && payloadType === SCOPE) return liveScope(peek.payload)
  if (spaces && payloadType === PROGRESS) {
    // Never emitted without the opt-in; one arriving anyway is not ours to
    // surface (an unrequested value must not reach the consumer).
    if (!opts?.progress) return SKIP_FRAME
    const result = wireProgressPayload.safeValidate(peek.payload)
    if (!result.success) {
      throw new MalformedError('invalid progress frame', {
        cause: result.reason,
      })
    }
    const { throughSeq, caughtUp } = result.value
    if (!Number.isSafeInteger(throughSeq)) {
      throw new MalformedError('progress throughSeq is not a safe integer')
    }
    return { progress: { kind: 'progress', throughSeq, caughtUp } }
  }
  if (
    payloadType !== COMMIT &&
    payloadType !== IDENTITY &&
    payloadType !== ACCOUNT &&
    payloadType !== SYNC
  ) {
    return SKIP_FRAME // unknown payload type: skip for forward compatibility
  }

  // PERF: strict mode only — one predictable branch on the hot path.
  if (validateWire) {
    const result = wirePayload.safeValidate(peek.payload)
    if (!result.success) {
      throw new MalformedError('wire validation failed', {
        cause: result.reason,
      })
    }
  }
  const p = (parsed as { payload: WirePayload }).payload // optimistic boundary

  // seq IS the cursor (dedup, resume, watermark), so it is checked in every
  // mode. v2 seqs are 1-based: seq <= 0 means a missing or invalid required
  // field that the dedup floor would otherwise swallow silently.
  const seq = p.seq
  if (!Number.isSafeInteger(seq) || seq <= 0) {
    throw new MalformedError(
      `live seq is not a positive safe integer (got ${String(seq)})`,
    )
  }
  const did = p.did
  // `time` passes through as a branded string, like did/collection/rkey: the
  // v2 envelope carries it verbatim and nothing re-encodes it. validateWire
  // format-checks it via the wire schema.
  const time = p.time
  const base = { did, seq, time }
  // `space` is copied only on a Spaces stream, and only when present (absent
  // is the public namespace): public events keep exactly their old keys.
  let scoped: typeof base & { space?: string } = base
  if (spaces && (p.$type === COMMIT || p.$type === SYNC) && 'space' in p) {
    const result = wireSpace.safeValidate(p.space)
    if (!result.success) {
      throw new MalformedError(`invalid live event space (seq=${seq})`, {
        cause: result.reason,
      })
    }
    if (result.value !== undefined) scoped = { ...base, space: result.value }
  }

  switch (p.$type) {
    case COMMIT:
      return { ...scoped, kind: 'commit', commit: liveCommit(p) }
    case IDENTITY: {
      const identity: Identity = {
        did: p.identity.did || did,
        handle: p.identity.handle,
        time: p.identity.time,
      }
      return { ...base, kind: 'identity', identity }
    }
    case ACCOUNT: {
      // The cast above is optimistic (non-strict mode skips validation), so
      // `active` can still be absent or non-boolean here even though the
      // schema marks it required. It is the takedown/deactivation signal, so
      // defaulting a missing value to `false` would fabricate "deactivated"
      // — throw instead, in every mode.
      if (typeof p.account.active !== 'boolean') {
        throw new MalformedError(
          `live account event missing required field active (did=${did})`,
        )
      }
      const account: Account = {
        did: p.account.did || did,
        active: p.account.active,
        status: p.account.status,
        time: p.account.time,
      }
      return { ...base, kind: 'account', account }
    }
    case SYNC: {
      const sync: Sync = {
        did: p.sync.did || did,
        rev: p.sync.rev,
        time: p.sync.time,
      }
      return { ...scoped, kind: 'sync', sync }
    }
  }
}

// The #scope marker: did is the removed author for repoRemoved and absent for
// spaceDeleted — nothing is fabricated for the authorless case.
function liveScope(payload: unknown): RawSpacesEvent<RawRecordJson> {
  const result = wireScopePayload.safeValidate(payload)
  if (!result.success) {
    throw new MalformedError('invalid scope frame', { cause: result.reason })
  }
  const p = result.value
  if (!Number.isSafeInteger(p.seq)) {
    throw new MalformedError(`live seq is not a positive safe integer`)
  }
  const extra = {
    ...(p.cause !== undefined ? { cause: p.cause } : {}),
    ...(p.lastKnownRev !== undefined ? { lastKnownRev: p.lastKnownRev } : {}),
  }
  const envelope = { seq: p.seq, time: p.time, space: p.space }
  if (p.operation === 'repoRemoved') {
    if (p.did === undefined) {
      throw new MalformedError(`repoRemoved scope without did (seq=${p.seq})`)
    }
    return {
      ...envelope,
      did: p.did,
      kind: 'scope',
      scope: { operation: 'repoRemoved', did: p.did, ...extra },
    }
  }
  if (p.did !== undefined) {
    throw new MalformedError(`spaceDeleted scope with did (seq=${p.seq})`)
  }
  return {
    ...envelope,
    kind: 'scope',
    scope: { operation: 'spaceDeleted', ...extra },
  }
}

function liveCommit(p: WireCommitPayload): RawCommit<RawRecordJson> {
  // Widen to string: the cast above is optimistic, so garbage flows here in
  // default mode.
  const op: string = p.operation
  // Deliberately stricter than the lexicon's knownValues: RawCommit has no
  // field to hold an unrecognized operation's data, so throwing beats
  // misclassifying it as one of the three we know.
  if (op !== 'create' && op !== 'update' && op !== 'delete') {
    throw new MalformedError(
      `unknown live commit operation ${JSON.stringify(op)}`,
    )
  }
  if (op === 'delete') {
    return {
      operation: 'delete',
      collection: p.collection,
      rkey: p.rkey,
      rev: p.rev,
    }
  }
  // Both are required on a put by the lexicon, so absence is a contract
  // violation rather than something to default.
  if (p.record === undefined) {
    throw new MalformedError(
      `live ${op} commit missing record (collection=${p.collection} rkey=${p.rkey})`,
    )
  }
  if (p.cid === undefined) {
    throw new MalformedError(
      `live ${op} commit missing cid (collection=${p.collection} rkey=${p.rkey})`,
    )
  }
  const commit: RawPutCommit<RawRecordJson> = {
    operation: op,
    collection: p.collection,
    rkey: p.rkey,
    rev: p.rev,
    cid: p.cid,
    record: p.record as RawRecordJson,
  }
  return commit
}
