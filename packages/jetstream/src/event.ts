import {
  type CidString,
  type DatetimeString,
  type DidString,
  type HandleString,
  type NsidString,
  type RecordKeyString,
  type TidString,
} from '@atproto/lex'

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
  did: DidString
  seq: number
  timeUs: number
}

/**
 * The record shape earned by collection filtering alone (no schema
 * validation): the server routed the event by collection, and a record's
 * $type is its collection NSID — we trust that rather than re-checking at
 * runtime. TType carries the collection literal when the filter provides one.
 */
export type UnvalidatedRecord<TType extends string = string> = {
  $type: TType
} & Record<string, unknown>

export interface TypedPutCommit<R = unknown, C extends string = NsidString> {
  operation: 'create' | 'update'
  collection: C
  rkey: RecordKeyString
  rev: TidString
  cid: CidString
  record: R
  validationError?: Error
}

export interface DeleteCommit<C extends string = NsidString> {
  operation: 'delete'
  collection: C
  rkey: RecordKeyString
  rev: TidString
}

export type TypedCommit<R = unknown> = TypedPutCommit<R> | DeleteCommit

export interface Identity {
  did: DidString
  handle?: HandleString
  time?: DatetimeString
}
export interface Account {
  did: DidString
  active: boolean
  status?: string
  time?: DatetimeString
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
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  cid: CidString
  record: unknown // v1 wire carries parsed JSON; no canonical CBOR exists
}
export type RawCommitV1 = RawPutCommitV1 | DeleteCommit
export type RawEventV1 =
  | (EventBase & { kind: 'commit'; commit: RawCommitV1 })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })

/**
 * Default per-key serialization key for concurrent indexers: the record path
 * of a commit event, or the bare DID for non-commit kinds. This is ONLY a
 * concurrency key — it needs stability and per-record uniqueness, not AT-URI
 * validity, so naive concatenation is correct and cheap. It must not double
 * as an event's public `uri`: it skips URI validation and can return a bare
 * DID.
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
