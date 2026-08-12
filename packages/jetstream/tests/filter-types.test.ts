import {
  type InferOutput,
  type NsidString,
  type TypedLexMap,
  l,
  record,
} from '@atproto/lex'
import { expectTypeOf, test } from 'vitest'
import { type DeleteCommit, type TypedEvent } from '../src/event.js'
import { type TypedCommitFor, type TypedEventFor } from '../src/filter-types.js'

// likeSchema is consumed only via `typeof likeSchema`; the runtime value is
// required for that type query, so eslint's no-unused-vars is a false positive.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)
type Like = InferOutput<typeof likeSchema>

type PutOf<C> = Exclude<C, { operation: 'delete' }>

test('validating schema filter narrows collection and record; no validationError', () => {
  type Commit = TypedCommitFor<typeof likeSchema>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<'app.test.like'>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<Like>()
  expectTypeOf<PutOf<Commit>>().not.toHaveProperty('validationError')
  // the delete variant narrows collection too
  expectTypeOf<Extract<Commit, { operation: 'delete' }>>().toEqualTypeOf<
    DeleteCommit<'app.test.like'>
  >()
})

test('validateRecord: false keeps the collection literal, floor-types the record', () => {
  type Commit = TypedCommitFor<{
    collection: typeof likeSchema
    validateRecord: false
  }>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<'app.test.like'>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<
    TypedLexMap<'app.test.like'>
  >()
  // unvalidated commits keep validationError (decode failures flow through)
  expectTypeOf<PutOf<Commit>>().toHaveProperty('validationError')
})

test('string literal filter floor-types the record with its literal', () => {
  type Commit = TypedCommitFor<'app.test.post'>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<'app.test.post'>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<
    TypedLexMap<'app.test.post'>
  >()
  // string filters are unvalidated: validationError stays available
  expectTypeOf<PutOf<Commit>>().toHaveProperty('validationError')
})

test('wildcard filter maps to a template-literal collection', () => {
  type Commit = TypedCommitFor<'app.test.*'>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<`app.test.${string}`>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<
    TypedLexMap<`app.test.${string}`>
  >()
})

test('a bare NsidString filter (no literal) floor-types with the brand', () => {
  type Commit = TypedCommitFor<NsidString>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<NsidString>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<
    TypedLexMap<NsidString>
  >()
})

test('empty filter tuple falls back to plain TypedEvent', () => {
  expectTypeOf<TypedEventFor<readonly []>>().toEqualTypeOf<TypedEvent>()
})

test('mixed filters form a correlated union narrowed by collection', () => {
  type Ev = TypedEventFor<readonly [typeof likeSchema, 'app.test.post']>
  const ev = {} as Ev
  if (ev.kind === 'commit' && ev.commit.operation !== 'delete') {
    if (ev.commit.collection === 'app.test.like') {
      expectTypeOf(ev.commit.record).toEqualTypeOf<Like>()
    }
    if (ev.commit.collection === 'app.test.post') {
      expectTypeOf(ev.commit.record).toEqualTypeOf<
        TypedLexMap<'app.test.post'>
      >()
    }
  }
})

test('namespace (Main) form narrows like the bare schema', () => {
  type Commit = TypedCommitFor<{ main: typeof likeSchema }>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<'app.test.like'>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<Like>()
})

test('opts form with validateRecord omitted behaves like the bare schema', () => {
  type Commit = TypedCommitFor<{ collection: typeof likeSchema }>
  expectTypeOf<Commit['collection']>().toEqualTypeOf<'app.test.like'>()
  expectTypeOf<PutOf<Commit>['record']>().toEqualTypeOf<Like>()
  expectTypeOf<PutOf<Commit>>().not.toHaveProperty('validationError')
})

test('non-commit event kinds are unaffected by the filter generic', () => {
  type Ev = TypedEventFor<readonly [typeof likeSchema]>
  type Identity = Extract<Ev, { kind: 'identity' }>
  expectTypeOf<Identity>().toEqualTypeOf<
    Extract<TypedEvent, { kind: 'identity' }>
  >()
  expectTypeOf<Extract<Ev, { kind: 'account' }>>().toEqualTypeOf<
    Extract<TypedEvent, { kind: 'account' }>
  >()
})
