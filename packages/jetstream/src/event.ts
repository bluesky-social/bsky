export type Operation = 'create' | 'update' | 'delete'
export type Kind = 'commit' | 'identity' | 'account'

/**
 * The minimal envelope contract every event the SDK yields satisfies (v1: seq =
 * time_us). It is the only thing the cursor/dedup/batching/tracking machinery
 * needs.
 */
export interface SeqEvent {
  seq: number
}

export interface EventBase {
  did: string
  seq: number
  timeUs: number
}

export interface TypedPutCommit<R = unknown> {
  operation: 'create' | 'update'
  collection: string
  rkey: string
  rev: string
  cid: string
  record: R
  validationError?: Error
}

export interface DeleteCommit {
  operation: 'delete'
  collection: string
  rkey: string
  rev: string
}

export type TypedCommit<R = unknown> = TypedPutCommit<R> | DeleteCommit

export interface Identity {
  did: string
  handle?: string
  time?: string
}
export interface Account {
  did: string
  active: boolean
  status?: string
  time?: string
}

export type TypedEvent<R = unknown> =
  | (EventBase & { kind: 'commit'; commit: TypedCommit<R> })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })

export interface EventBatch<E> {
  events: E[]
  lastCursor: number
}

export interface RawPutCommitV1 {
  operation: 'create' | 'update'
  collection: string
  rkey: string
  rev: string
  cid: string
  record: unknown // v1 wire carries parsed JSON; no canonical CBOR exists
}
export type RawCommitV1 = RawPutCommitV1 | DeleteCommit
export type RawEventV1 =
  | (EventBase & { kind: 'commit'; commit: RawCommitV1 })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })

/**
 * The at:// URI of a commit event (at://did/collection/rkey), or the bare DID
 * for non-commit kinds. Used as the default per-key serialization key for
 * concurrent indexers.
 */
export function eventUri(ev: {
  kind: string
  did: string
  commit?: { collection: string; rkey: string }
}): string {
  if (ev.kind === 'commit' && ev.commit) {
    return `at://${ev.did}/${ev.commit.collection}/${ev.commit.rkey}`
  }
  return ev.did
}
