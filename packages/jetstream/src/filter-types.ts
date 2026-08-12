import {
  type InferOutput,
  type RecordSchema,
  type TypedLexMap,
} from '@atproto/lex'
import { type CollectionFilter } from './engine/collections.js'
import {
  type Account,
  type DeleteCommit,
  type EventBase,
  type EventBaseV1,
  type Identity,
  type Sync,
  type TypedEvent,
  type TypedEventV1,
  type TypedPutCommit,
} from './event.js'

// Unwrap Main<S> = S | { main: S } to the schema itself.
type MainOf<M> = M extends { main: infer S } ? S : M

// Put + delete union for one collection literal. UnvalidatedCommit keeps
// validationError (decode failures still flow through it); ValidatedCommit
// drops it — invalid events were skipped, so record is honestly valid. These
// names surface in editor hovers on TypedCommitFor.
type UnvalidatedCommit<C extends string, R> =
  TypedPutCommit<R, C> | DeleteCommit<C>
type ValidatedCommit<C extends string, R> =
  Omit<TypedPutCommit<R, C>, 'validationError'> | DeleteCommit<C>

// 'app.test.*' → `app.test.${string}`; literal NSIDs keep their literal;
// non-literal string degrades to string.
type StringFilterCommit<F extends string> = F extends `${infer P}.*`
  ? UnvalidatedCommit<`${P}.${string}`, TypedLexMap<`${P}.${string}`>>
  : string extends F
    ? UnvalidatedCommit<string, TypedLexMap>
    : UnvalidatedCommit<F, TypedLexMap<F>>

// The commit shape(s) contributed by ONE filter. Distributes over a union of
// filters (F[number]) to build the correlated union: checking
// commit.collection === '...' narrows commit.record.
export type TypedCommitFor<F extends CollectionFilter> = F extends string
  ? StringFilterCommit<F>
  : F extends { collection: infer M; validateRecord: false }
    ? MainOf<M> extends infer S extends RecordSchema
      ? UnvalidatedCommit<S['$type'], TypedLexMap<S['$type']>>
      : never
    : F extends { collection: infer M }
      ? MainOf<M> extends infer S extends RecordSchema
        ? ValidatedCommit<S['$type'], InferOutput<S>>
        : never
      : MainOf<F> extends infer S extends RecordSchema
        ? ValidatedCommit<S['$type'], InferOutput<S>>
        : never

// The typed event union for a v2 filter tuple. No filters (readonly []) means
// no narrowing was earned: plain TypedEvent. Non-commit kinds are identical
// across all filters.
export type TypedEventFor<F extends readonly CollectionFilter[]> =
  F extends readonly []
    ? TypedEvent
    : | (EventBase & { kind: 'commit'; commit: TypedCommitFor<F[number]> })
      | (EventBase & { kind: 'identity'; identity: Identity })
      | (EventBase & { kind: 'account'; account: Account })
      | (EventBase & { kind: 'sync'; sync: Sync })

// The v1 equivalent: its own envelope, and no sync arm. Declared rather than
// derived from TypedEventFor — the envelopes diverge, so an Exclude would not
// express it.
export type TypedEventV1For<F extends readonly CollectionFilter[]> =
  F extends readonly []
    ? TypedEventV1
    : | (EventBaseV1 & { kind: 'commit'; commit: TypedCommitFor<F[number]> })
      | (EventBaseV1 & { kind: 'identity'; identity: Identity })
      | (EventBaseV1 & { kind: 'account'; account: Account })

// The widest event a live() implementation signature accepts: CollectionFilter[]
// (not a specific tuple) makes TypedCommitFor<F[number]> assignable for any
// concrete filter tuple a caller might pass. The empty-tuple case (no filter
// at all) is unioned in separately: TypedEventFor<readonly []> is plain
// TypedEvent, whose default (untied to any collection) record type is
// TypedLexMap<string> — narrower-branded than the CollectionFilter[] arms'
// TypedLexMap<NsidString>-and-friends, so it is not covered by
// TypedEventFor<CollectionFilter[]> alone.
export type WideTypedEvent = TypedEventFor<CollectionFilter[]> | TypedEvent
export type WideTypedEventV1 =
  TypedEventV1For<CollectionFilter[]> | TypedEventV1
