import {
  type CidString,
  type DatetimeString,
  type DidString,
  type HandleString,
  type NsidString,
  type RecordKeyString,
  type TidString,
} from '@atproto/lex'
import { type RawRecord, type RawRecordJson } from './raw-record.js'

export type Operation = 'create' | 'update' | 'delete'

/** Event kinds on the v2 wire. */
export type Kind = 'commit' | 'identity' | 'account' | 'sync'
/** Event kinds on the frozen v1 wire — it never emits sync. */
export type KindV1 = 'commit' | 'identity' | 'account'

/**
 * The minimal envelope the cursor/dedup/batching/tracking machinery needs. Both
 * wires' events satisfy it, which is why that machinery is version-agnostic.
 */
export interface SeqEvent {
  seq: number
}

/**
 * The v2 envelope. `seq` is the cursor; `time` is the wire datetime passed
 * through untouched — nothing re-encodes it.
 */
export interface EventBase {
  did: DidString
  seq: number
  time: DatetimeString
}

/**
 * The v1 envelope. v1's cursor IS its `time_us` field, so seq and timeUs are
 * always the same value. Deliberately separate from EventBase: the wires
 * disagree here and unifying them would mean converting one into the other.
 */
export interface EventBaseV1 {
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

// The relay's #sync event, reduced to what a consumer can act on. The wire
// carries `blocks` (the signed commit) too; we discard it. v2 only.
export interface Sync {
  did: DidString
  rev: TidString
  time?: DatetimeString
}

export type TypedEvent<R = unknown> =
  | (EventBase & { kind: 'commit'; commit: TypedCommit<R> })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })
  | (EventBase & { kind: 'sync'; sync: Sync })

export type TypedEventV1<R = unknown> =
  | (EventBaseV1 & { kind: 'commit'; commit: TypedCommit<R> })
  | (EventBaseV1 & { kind: 'identity'; identity: Identity })
  | (EventBaseV1 & { kind: 'account'; account: Account })

export interface EventBatch<E> {
  events: E[]
  lastCursor: number
}

/**
 * A put commit's record in its wire representation. Identical on both wires
 * today. The generic has one arm now; snapshot support widens RawRecord to
 * include DAG-CBOR bytes, and this parameter is how each mode narrows to the
 * arm it yields.
 */
export interface RawPutCommit<T extends RawRecord = RawRecord> {
  operation: 'create' | 'update'
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  cid: CidString
  record: T
}
export type RawCommit<T extends RawRecord = RawRecord> =
  RawPutCommit<T> | DeleteCommit

/** A v2 live or archive event. */
export type RawEvent<T extends RawRecord = RawRecord> =
  | (EventBase & { kind: 'commit'; commit: RawCommit<T> })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })
  | (EventBase & { kind: 'sync'; sync: Sync })

/** A v1 live event. Not assignable to RawEvent — the envelopes differ. */
export type RawEventV1 =
  | (EventBaseV1 & { kind: 'commit'; commit: RawCommit<RawRecordJson> })
  | (EventBaseV1 & { kind: 'identity'; identity: Identity })
  | (EventBaseV1 & { kind: 'account'; account: Account })

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
