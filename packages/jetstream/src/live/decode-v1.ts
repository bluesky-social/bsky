import { type InferOutput, l } from '@atproto/lex'
import { MalformedError } from '../errors.js'
import { type Account, type Identity, type RawEventV1 } from '../event.js'
import { type RawRecordJson } from '../raw-record.js'
import { SKIP_FRAME } from './decode.js'

// v1 wire frame — the authoritative jetstream-legacy shape
// (bluesky-social/jetstream-legacy pkg/models/models.go): kind:
// "commit"|"identity"|"account", commit.operation:
// "create"|"update"|"delete". record is parsed JSON (never CBOR); cid is a
// wire string. time_us is the cursor: strictly monotonic and unique (v1's
// monotonic.Clock guarantees now > last), so it maps directly onto seq.
// Prototype-era short codes (type: "com", commit.type: "c") are not deployed
// and not supported — such frames fall out as unknown kinds (SKIP_FRAME).
// The schema below is the single wire contract: WireV1Frame is inferred from
// it, the `as WireV1Frame` cast is the single optimistic boundary, and
// validateWire strict mode safeValidates the SAME schema.
const wireV1Envelope = {
  did: l.string({ format: 'did' }),
  // time_us IS the v1 cursor (strictly monotonic, unique) — required.
  time_us: l.integer(),
}
const wireV1CommitFrame = l.object({
  ...wireV1Envelope,
  kind: l.literal('commit'),
  commit: l.union([
    l.object({
      operation: l.union([l.literal('create'), l.literal('update')]),
      collection: l.string({ format: 'nsid' }),
      rkey: l.string({ format: 'record-key' }),
      rev: l.string({ format: 'tid' }),
      cid: l.string({ format: 'cid' }), // the v1 wire cid IS checked
      record: l.unknown(), // parsed JSON body — never format-checked
    }),
    l.object({
      operation: l.literal('delete'),
      collection: l.string({ format: 'nsid' }),
      rkey: l.string({ format: 'record-key' }),
      rev: l.string({ format: 'tid' }),
    }),
  ]),
})
const wireV1IdentityFrame = l.object({
  ...wireV1Envelope,
  kind: l.literal('identity'),
  identity: l.object({
    did: l.string({ format: 'did' }),
    handle: l.optional(l.string({ format: 'handle' })),
    time: l.optional(l.string({ format: 'datetime' })),
  }),
})
const wireV1AccountFrame = l.object({
  ...wireV1Envelope,
  kind: l.literal('account'),
  account: l.object({
    did: l.string({ format: 'did' }),
    active: l.optional(l.boolean()),
    status: l.optional(l.string()),
    time: l.optional(l.string({ format: 'datetime' })),
  }),
})
const wireV1Frame = l.union([
  wireV1CommitFrame,
  wireV1IdentityFrame,
  wireV1AccountFrame,
])
type WireV1Frame = InferOutput<typeof wireV1Frame>

// Pre-discrimination peek: error frames and unknown/control kinds are handled
// before the WireV1Frame cast (l.union rejects unknown discriminants by design).
interface PeekFrame {
  kind?: string
  error?: string
  message?: string
}

const td = new TextDecoder()

export function decodeLiveFrameV1(
  data: Uint8Array | string,
  validateWire?: boolean,
): RawEventV1 | typeof SKIP_FRAME {
  const text = typeof data === 'string' ? data : td.decode(data)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new MalformedError('decode v1 live frame', { cause: err })
  }
  const peek = parsed as PeekFrame
  if (peek.error) {
    throw new MalformedError(
      `v1 live error frame: ${peek.error}: ${peek.message ?? ''}`,
    )
  }
  if (
    peek.kind !== 'commit' &&
    peek.kind !== 'identity' &&
    peek.kind !== 'account'
  ) {
    // Unknown or control kind (prototype short codes, etc.): skip.
    return SKIP_FRAME
  }
  // PERF: strict mode only — one predictable branch on the hot path.
  if (validateWire) {
    const result = wireV1Frame.safeValidate(parsed)
    if (!result.success) {
      throw new MalformedError('wire validation failed', {
        cause: result.reason,
      })
    }
  }
  const f = parsed as WireV1Frame // the single optimistic boundary
  const seq = f.time_us
  // seq IS the cursor (dedup, resume, watermark) — a lossy or non-integer
  // time_us silently corrupts all of them, so this is checked in EVERY mode,
  // not just validateWire.
  if (!Number.isSafeInteger(seq)) {
    throw new MalformedError(
      `v1 time_us is not a safe integer (got ${String(seq)})`,
    )
  }
  const did = f.did
  const base = { did, seq, timeUs: seq }

  switch (f.kind) {
    case 'commit': {
      const c = f.commit
      if (!c)
        throw new MalformedError(`v1 commit frame missing payload (seq=${seq})`)
      const op = c.operation
      if (op !== 'create' && op !== 'update' && op !== 'delete')
        throw new MalformedError(`v1 commit unknown operation (seq=${seq})`)
      if (op === 'delete') {
        return {
          ...base,
          kind: 'commit',
          commit: {
            operation: 'delete',
            collection: c.collection,
            rkey: c.rkey,
            rev: c.rev,
          },
        }
      }
      if (c.record === undefined || !c.cid) {
        throw new MalformedError(
          `v1 ${op} commit missing record/cid (collection=${c.collection} rkey=${c.rkey})`,
        )
      }
      return {
        ...base,
        kind: 'commit',
        commit: {
          operation: op,
          collection: c.collection,
          rkey: c.rkey,
          rev: c.rev,
          cid: c.cid,
          record: c.record as RawRecordJson,
        },
      }
    }
    case 'identity': {
      if (!f.identity)
        throw new MalformedError(
          `v1 identity frame missing payload (seq=${seq})`,
        )
      const identity: Identity = {
        did: f.identity.did || did,
        handle: f.identity.handle,
        time: f.identity.time,
      }
      return { ...base, kind: 'identity', identity }
    }
    case 'account': {
      if (!f.account)
        throw new MalformedError(
          `v1 account frame missing payload (seq=${seq})`,
        )
      const account: Account = {
        did: f.account.did || did,
        active: f.account.active ?? false,
        status: f.account.status,
        time: f.account.time,
      }
      return { ...base, kind: 'account', account }
    }
  }
}
