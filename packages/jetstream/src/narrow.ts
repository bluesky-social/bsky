import {
  type Main,
  type NsidString,
  type RecordSchema,
  type TypedLexMap,
  type TypedRecord,
  getMain,
} from '@atproto/lex'
import { type Operation } from './event.js'

/**
 * The optional lexicon argument to the narrowing helpers: a record schema
 * (bare or namespace form, like collection filters) or a bare NSID literal.
 */
export type EventLexicon = NsidString | Main<RecordSchema>

// Unwrap Main<S> = S | { main: S } to the schema itself.
type MainOf<M> = M extends { main: infer S } ? S : M

// The collection literal a lexicon argument narrows to.
type CollectionOf<L extends EventLexicon> = L extends string
  ? L
  : MainOf<L> extends { $type: infer T extends string }
    ? T
    : never

/**
 * A commit arm narrowed by operation and (optionally) collection. Purely
 * type-level, mirroring $isTypeOf. An arm survives only if its operation and
 * collection can overlap the target; `collection` and `record` then narrow to
 * whichever of the arm's own type and the target is more specific. A
 * non-overlapping arm is eliminated.
 */
type NarrowedCommit<C, O extends Operation, T extends string> = C extends {
  operation: infer P extends Operation
  collection: infer K extends string
}
  ? [Extract<P, O>] extends [never]
    ? never
    : [K] extends [T]
      ? Narrowed<C, Extract<P, O>, K, T>
      : [T] extends [K]
        ? Narrowed<C, Extract<P, O>, T, T>
        : never
  : never

// Rebuild a commit arm, keeping whichever of the arm's collection (KOut) and
// the target is more specific. A put arm whose record type cannot be the
// target collection's record is dropped whole: matching it would be a
// contradiction, not a wider match.
type Narrowed<C, P, KOut extends string, T extends string> = C extends {
  record: infer R
}
  ? [NarrowedRecord<R, T>] extends [never]
    ? never
    : Omit<C, 'operation' | 'collection' | 'record'> & {
        operation: P
        collection: KOut
        record: NarrowedRecord<R, T>
      }
  : Omit<C, 'operation' | 'collection'> & { operation: P; collection: KOut }

/**
 * Narrow a put commit's record to the target collection, delegating to
 * @atproto/lex's `TypedRecord` — the narrowing `$isTypeOf` performs. A lexicon
 * therefore narrows a jetstream record exactly as it narrows a record
 * anywhere else in the ecosystem: an arm already typed with the target keeps
 * its type, a wider `$type` (`TypedLexMap<NsidString>`, a wildcard template)
 * tightens to the target while keeping the record's own shape, an arm whose
 * `$type` contradicts the target drops out, and so does an open union's
 * unknown arm.
 *
 * Only `$type`'d lex maps go through it. A raw wire record (JSON or CBOR) was
 * never decoded, so giving it a lex type would be a lie — it is left alone. A
 * call with no lexicon (T is `string`, not an NSID) narrows nothing.
 */
type NarrowedRecord<R, T extends string> = T extends NsidString
  ? R extends TypedLexMap
    ? TypedRecord<T, R>
    : R
  : R

/**
 * An event union narrowed to commit arms matching an operation and optional
 * collection. Distributes over the event union (v1 and v2 envelopes both
 * survive intact) and over each arm's commit union; arms with no matching
 * commit disappear entirely.
 */
export type NarrowedEvent<
  E,
  O extends Operation,
  T extends string = string,
> = E extends { kind: 'commit'; commit: infer C }
  ? [NarrowedCommit<C, O, T>] extends [never]
    ? never
    : Omit<E, 'commit'> & { commit: NarrowedCommit<C, O, T> }
  : never

// The widest event shape the helpers inspect at runtime. Optional commit:
// non-commit kinds carry none.
interface AnyEvent {
  kind: string
  commit?: { operation: string; collection: string }
}

// Shared runtime for all four helpers: three cheap checks, no validation.
function isCommitOp(
  ev: AnyEvent,
  lexicon: EventLexicon | undefined,
  op1: Operation,
  op2?: Operation,
): boolean {
  if (ev.kind !== 'commit' || ev.commit === undefined) return false
  const { operation, collection } = ev.commit
  if (operation !== op1 && operation !== op2) return false
  if (lexicon === undefined) return true
  const nsid = typeof lexicon === 'string' ? lexicon : getMain(lexicon).$type
  return collection === nsid
}

/**
 * Narrows an event to a create commit, optionally for one lexicon. Type
 * narrowing only — the record is NOT validated; pair with a validating
 * collection filter (or validate the record) when shape guarantees matter.
 */
export function isCreate<E extends AnyEvent>(
  ev: E,
): ev is NarrowedEvent<E, 'create'>
export function isCreate<E extends AnyEvent, L extends EventLexicon>(
  ev: E,
  lexicon: L,
): ev is NarrowedEvent<E, 'create', CollectionOf<L>>
export function isCreate(ev: AnyEvent, lexicon?: EventLexicon): boolean {
  return isCommitOp(ev, lexicon, 'create')
}

/** Narrows an event to an update commit. See {@link isCreate}. */
export function isUpdate<E extends AnyEvent>(
  ev: E,
): ev is NarrowedEvent<E, 'update'>
export function isUpdate<E extends AnyEvent, L extends EventLexicon>(
  ev: E,
  lexicon: L,
): ev is NarrowedEvent<E, 'update', CollectionOf<L>>
export function isUpdate(ev: AnyEvent, lexicon?: EventLexicon): boolean {
  return isCommitOp(ev, lexicon, 'update')
}

/** Narrows an event to a delete commit. See {@link isCreate}. */
export function isDelete<E extends AnyEvent>(
  ev: E,
): ev is NarrowedEvent<E, 'delete'>
export function isDelete<E extends AnyEvent, L extends EventLexicon>(
  ev: E,
  lexicon: L,
): ev is NarrowedEvent<E, 'delete', CollectionOf<L>>
export function isDelete(ev: AnyEvent, lexicon?: EventLexicon): boolean {
  return isCommitOp(ev, lexicon, 'delete')
}

/**
 * Narrows an event to a put (create or update) commit — the arms that carry
 * a record. See {@link isCreate}.
 */
export function isPut<E extends AnyEvent>(
  ev: E,
): ev is NarrowedEvent<E, 'create' | 'update'>
export function isPut<E extends AnyEvent, L extends EventLexicon>(
  ev: E,
  lexicon: L,
): ev is NarrowedEvent<E, 'create' | 'update', CollectionOf<L>>
export function isPut(ev: AnyEvent, lexicon?: EventLexicon): boolean {
  return isCommitOp(ev, lexicon, 'create', 'update')
}
