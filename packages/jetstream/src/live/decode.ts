import { type InferOutput, l } from '@atproto/lex'
import { MalformedError, XrpcSubscriptionError } from '../errors.js'
import {
  type Account,
  type Identity,
  type RawCommit,
  type RawEvent,
  type RawPutCommit,
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

/**
 * A seq-less advisory (today only `OutdatedCursor`, sent when a
 * timestamp-domain cursor was clamped). Kept distinct from SKIP_FRAME so
 * liveEvents can report it instead of discarding it silently.
 */
export interface LiveInfoFrame {
  info: { name: string; message?: string }
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
    active: l.optional(l.boolean()),
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
): RawEvent<RawRecordJson> | LiveInfoFrame | typeof SKIP_FRAME {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof data === 'string' ? data : td.decode(data))
  } catch (err) {
    throw new MalformedError('decode live frame', { cause: err })
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

  switch (p.$type) {
    case COMMIT:
      return { ...base, kind: 'commit', commit: liveCommit(p) }
    case IDENTITY: {
      const identity: Identity = {
        did: p.identity.did || did,
        handle: p.identity.handle,
        time: p.identity.time,
      }
      return { ...base, kind: 'identity', identity }
    }
    case ACCOUNT: {
      const account: Account = {
        did: p.account.did || did,
        active: Boolean(p.account.active),
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
      return { ...base, kind: 'sync', sync }
    }
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
