import { type InferOutput, type RecordSchema } from '@atproto/lex'
import { type CollectionFilter } from './engine/collections.js'
import {
  type Account,
  type DeleteCommit,
  type EventBase,
  type Identity,
  type TypedEvent,
  type TypedPutCommit,
  type UnvalidatedRecord,
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
  ? UnvalidatedCommit<`${P}.${string}`, UnvalidatedRecord<`${P}.${string}`>>
  : string extends F
    ? UnvalidatedCommit<string, UnvalidatedRecord>
    : UnvalidatedCommit<F, UnvalidatedRecord<F>>

// The commit shape(s) contributed by ONE filter. Distributes over a union of
// filters (F[number]) to build the correlated union: checking
// commit.collection === '...' narrows commit.record.
export type TypedCommitFor<F extends CollectionFilter> = F extends string
  ? StringFilterCommit<F>
  : F extends { collection: infer M; validateRecord: false }
    ? MainOf<M> extends infer S extends RecordSchema
      ? UnvalidatedCommit<S['$type'], UnvalidatedRecord<S['$type']>>
      : never
    : F extends { collection: infer M }
      ? MainOf<M> extends infer S extends RecordSchema
        ? ValidatedCommit<S['$type'], InferOutput<S>>
        : never
      : MainOf<F> extends infer S extends RecordSchema
        ? ValidatedCommit<S['$type'], InferOutput<S>>
        : never

// The typed event union for a filter tuple. No filters (readonly []) means
// no narrowing was earned: plain TypedEvent. Non-commit kinds are identical
// across all filters.
export type TypedEventFor<F extends readonly CollectionFilter[]> =
  F extends readonly []
    ? TypedEvent
    : | (EventBase & { kind: 'commit'; commit: TypedCommitFor<F[number]> })
      | (EventBase & { kind: 'identity'; identity: Identity })
      | (EventBase & { kind: 'account'; account: Account })
