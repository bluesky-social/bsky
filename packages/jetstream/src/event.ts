import {
  type CidString,
  type DatetimeString,
  type DidString,
  type HandleString,
  type NsidString,
  type RecordKeyString,
  type TidString,
  type TypedLexMap,
} from '@atproto/lex'
import { type RawRecord, type RawRecordJson } from './raw-record.js'

export type Operation = 'create' | 'update' | 'delete'

/** Event kinds on the v2 wire. */
export type Kind = 'commit' | 'identity' | 'account' | 'sync'
/** Event kinds on the frozen v1 wire — it never emits sync. */
export type KindV1 = 'commit' | 'identity' | 'account'
/**
 * Event kinds on a Spaces archive (protocolVersion=2): the v2 kinds plus
 * `scope`. Deliberately separate from Kind so public exhaustive switches and
 * `Record<Kind, …>` maps keep compiling.
 */
export type SpacesKind = Kind | 'scope'

/**
 * Which data contract a Jetstream instance speaks. `public` (the default) is
 * the public Jetstream v2 wire, byte-for-byte unchanged; `spaces` is the
 * space-sync archive contract (protocolVersion=2, archive format 2, scope
 * events), selected only explicitly.
 */
export type JetstreamMode = 'public' | 'spaces'

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

export interface TypedPutCommit<
  R = TypedLexMap,
  C extends string = NsidString,
> {
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

export type TypedCommit<R = TypedLexMap> = TypedPutCommit<R> | DeleteCommit

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

export type TypedEvent<R = TypedLexMap> =
  | (EventBase & { kind: 'commit'; commit: TypedCommit<R> })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })
  | (EventBase & { kind: 'sync'; sync: Sync })

export type TypedEventV1<R = TypedLexMap> =
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
 * A scope marker's payload: a sequenced, service-owned lifecycle statement,
 * not an authored deletion. `lastKnownRev` is the last observed source
 * revision, never a removal revision.
 */
export interface ScopeRepoRemoved {
  operation: 'repoRemoved'
  /** The author whose repository was removed from the event's space. */
  did: DidString
  cause?: string
  lastKnownRev?: string
}
/** The whole space was deleted; there is no author. See ScopeRepoRemoved. */
export interface ScopeSpaceDeleted {
  operation: 'spaceDeleted'
  cause?: string
  lastKnownRev?: string
}
export type Scope = ScopeRepoRemoved | ScopeSpaceDeleted

/**
 * A Spaces `scope` event. `space` is always present. repoRemoved carries the
 * removed author in `did` (also on `scope.did`); spaceDeleted has no author,
 * so `did` is absent — narrow on `scope.operation`.
 */
export type SpaceScopeEvent =
  | {
      seq: number
      time: DatetimeString
      space: string
      did: DidString
      kind: 'scope'
      scope: ScopeRepoRemoved
    }
  | {
      seq: number
      time: DatetimeString
      space: string
      did?: undefined
      kind: 'scope'
      scope: ScopeSpaceDeleted
    }

// Commit and sync events may carry the SpaceRef namespace they belong to;
// absent means the public namespace. `did` stays the original author.
// Identity and account events are global account lifecycle events and never
// carry one (typed `undefined` so `ev.space` reads on the whole union).
type Scoped = { space?: string }
type Global = { space?: undefined }

/** A Spaces live or archive event (see JetstreamMode). */
export type RawSpacesEvent<T extends RawRecord = RawRecord> =
  | (EventBase & Scoped & { kind: 'commit'; commit: RawCommit<T> })
  | (EventBase & Global & { kind: 'identity'; identity: Identity })
  | (EventBase & Global & { kind: 'account'; account: Account })
  | (EventBase & Scoped & { kind: 'sync'; sync: Sync })
  | SpaceScopeEvent

/** The typed form of RawSpacesEvent. */
export type TypedSpacesEvent<R = TypedLexMap> =
  | (EventBase & Scoped & { kind: 'commit'; commit: TypedCommit<R> })
  | (EventBase & Global & { kind: 'identity'; identity: Identity })
  | (EventBase & Global & { kind: 'account'; account: Account })
  | (EventBase & Scoped & { kind: 'sync'; sync: Sync })
  | SpaceScopeEvent

/**
 * Ordered coverage (Spaces, opt-in via `progress: true`): every eligible
 * event with seq <= throughSeq has already been delivered before this value,
 * including rows the filters dropped. Zero is valid (an empty archive). It is
 * not an event and never moves the event cursor. `caughtUp` is true only once
 * a live subscription scanned through the live edge pinned when it connected;
 * sealed-archive coverage never sets it.
 */
export interface JetstreamProgress {
  kind: 'progress'
  throughSeq: number
  caughtUp: boolean
}

/** A Spaces raw batch: events, then (optionally) coverage after them. */
export interface SpacesEventBatch<E> extends EventBatch<E> {
  /**
   * Coverage through the end of this batch. A progress-only batch has no
   * events and a lastCursor of 0 — never use that lastCursor as coverage.
   */
  progress?: JetstreamProgress
}

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

/**
 * The identity of a record on a Spaces archive: (space, author DID,
 * collection, rkey), as one opaque, injective string key. The same record
 * path can exist in the public namespace and in several spaces, so an at://
 * URI (which has no space) is not a unique key there. An absent `space` is
 * the public namespace. Accepts handler inputs (PutEvent, DelEvent) directly;
 * for a raw event pass `{ space: ev.space, did: ev.did, ...ev.commit }`.
 */
export function scopedRecordKey(record: {
  space?: string
  did: string
  collection: string
  rkey: string
}): string {
  return JSON.stringify([
    record.space ?? '',
    record.did,
    record.collection,
    record.rkey,
  ])
}
