import { MalformedError } from '../errors.js'
import { type Account, type Identity, type RawEventV1 } from '../event.js'
import { SKIP_FRAME } from './decode.js'

// v1 wire frame — the authoritative jetstream-legacy shape
// (bluesky-social/jetstream-legacy pkg/models/models.go): kind:
// "commit"|"identity"|"account", commit.operation:
// "create"|"update"|"delete". record is parsed JSON (never CBOR); cid is a
// wire string. time_us is the cursor: strictly monotonic and unique (v1's
// monotonic.Clock guarantees now > last), so it maps directly onto seq.
// Prototype-era short codes (type: "com", commit.type: "c") are not deployed
// and not supported — such frames fall out as unknown kinds (SKIP_FRAME).
interface WireV1Commit {
  rev?: string
  operation?: string
  collection?: string
  rkey?: string
  record?: unknown
  cid?: string
}
interface WireV1Frame {
  did?: string
  time_us?: number
  kind?: string
  commit?: WireV1Commit
  identity?: { did?: string; handle?: string; time?: string }
  account?: { did?: string; active?: boolean; status?: string; time?: string }
  error?: string
  message?: string
}

const td = new TextDecoder()

const KINDS = new Set(['commit', 'identity', 'account'])
const OPS = new Set(['create', 'update', 'delete'])

export function decodeLiveFrameV1(
  data: Uint8Array,
): RawEventV1 | typeof SKIP_FRAME {
  const text = td.decode(data)
  let f: WireV1Frame
  try {
    f = JSON.parse(text) as WireV1Frame
  } catch (err) {
    throw new MalformedError(`decode v1 live frame: ${(err as Error).message}`)
  }
  if (f.error) {
    throw new MalformedError(
      `v1 live error frame: ${f.error}: ${f.message ?? ''}`,
    )
  }
  const kind = f.kind
  if (!kind || !KINDS.has(kind)) return SKIP_FRAME

  const seq = f.time_us ?? 0
  const did = f.did ?? ''
  const base = { did, seq, timeUs: seq }

  switch (kind) {
    case 'commit': {
      const c = f.commit
      if (!c)
        throw new MalformedError(`v1 commit frame missing payload (seq=${seq})`)
      const op = c.operation
      if (!op || !OPS.has(op))
        throw new MalformedError(`v1 commit unknown operation (seq=${seq})`)
      if (op === 'delete') {
        return {
          ...base,
          kind: 'commit',
          commit: {
            operation: 'delete',
            collection: c.collection ?? '',
            rkey: c.rkey ?? '',
            rev: c.rev ?? '',
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
          operation: op as 'create' | 'update',
          collection: c.collection ?? '',
          rkey: c.rkey ?? '',
          rev: c.rev ?? '',
          cid: c.cid,
          record: c.record,
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
    default:
      return SKIP_FRAME
  }
}
