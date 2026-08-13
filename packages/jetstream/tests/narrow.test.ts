import { type InferOutput, type TypedLexMap, l, record } from '@atproto/lex'
import { expect, expectTypeOf, test } from 'vitest'
import {
  type RawEvent,
  type RawEventV1,
  type TypedEvent,
  type TypedEventV1,
} from '../src/event.js'
import { type TypedEventFor } from '../src/filter-types.js'
import { isCreate, isDelete, isPut, isUpdate } from '../src/narrow.js'
import { type RawRecord, type RawRecordJson } from '../src/raw-record.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)
type Like = InferOutput<typeof likeSchema>

// postSchema is consumed only via `typeof postSchema`; the runtime value is
// required for that type query, so eslint's no-unused-vars is a false positive.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const postSchema = record(
  'tid',
  'app.test.post',
  l.object({ text: l.string() }),
)
type Post = InferOutput<typeof postSchema>

// A record carrying a non-JSON lex value (bytes). Records made only of JSON
// values structurally satisfy the raw wire-JSON type, so a raw-vs-lex
// distinction drawn from the record type alone behaves differently for this
// schema than for `Post` — these two must narrow identically.
const bytesSchema = record(
  'tid',
  'app.test.bytes',
  l.object({ payload: l.bytes() }),
)
type Bytes = InferOutput<typeof bytesSchema>

// The shape real generated records have: optional properties and a blob.
const profileSchema = record(
  'literal:self',
  'app.test.profile',
  l.object({
    handle: l.string(),
    avatar: l.optional(l.blob()),
    description: l.optional(l.string()),
  }),
)
type Profile = InferOutput<typeof profileSchema>

const base = {
  did: 'did:example:alice',
  seq: 1,
  time: '2024-01-01T00:00:00.000Z',
}

function commitEvent(
  operation: 'create' | 'update' | 'delete',
  collection = 'app.test.like',
): Extract<TypedEvent, { kind: 'commit' }> {
  const commit =
    operation === 'delete'
      ? { operation, collection, rkey: '3jt5tlqcwvk24', rev: '3jt5tlqcwvk2a' }
      : {
          operation,
          collection,
          rkey: '3jt5tlqcwvk24',
          rev: '3jt5tlqcwvk2a',
          cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqrsqxi3jjq3u',
          record: { $type: collection, subject: 'at://did:example:bob' },
        }
  return { ...base, kind: 'commit', commit } as Extract<
    TypedEvent,
    { kind: 'commit' }
  >
}

const identityEvent = {
  ...base,
  kind: 'identity',
  identity: { did: base.did, handle: 'alice.test' },
} as TypedEvent

const accountEvent = {
  ...base,
  kind: 'account',
  account: { did: base.did, active: true },
} as TypedEvent

test('isCreate matches only create commits', () => {
  expect(isCreate(commitEvent('create'))).toBe(true)
  expect(isCreate(commitEvent('update'))).toBe(false)
  expect(isCreate(commitEvent('delete'))).toBe(false)
  expect(isCreate(identityEvent)).toBe(false)
  expect(isCreate(accountEvent)).toBe(false)
})

test('isUpdate matches only update commits', () => {
  expect(isUpdate(commitEvent('update'))).toBe(true)
  expect(isUpdate(commitEvent('create'))).toBe(false)
  expect(isUpdate(commitEvent('delete'))).toBe(false)
  expect(isUpdate(identityEvent)).toBe(false)
})

test('isDelete matches only delete commits', () => {
  expect(isDelete(commitEvent('delete'))).toBe(true)
  expect(isDelete(commitEvent('create'))).toBe(false)
  expect(isDelete(commitEvent('update'))).toBe(false)
  expect(isDelete(identityEvent)).toBe(false)
})

test('isPut matches create and update commits, not delete', () => {
  expect(isPut(commitEvent('create'))).toBe(true)
  expect(isPut(commitEvent('update'))).toBe(true)
  expect(isPut(commitEvent('delete'))).toBe(false)
  expect(isPut(identityEvent)).toBe(false)
})

test('a lexicon schema restricts matches to its collection', () => {
  expect(isCreate(commitEvent('create'), likeSchema)).toBe(true)
  expect(isCreate(commitEvent('create', 'app.test.post'), likeSchema)).toBe(
    false,
  )
  expect(isDelete(commitEvent('delete'), likeSchema)).toBe(true)
  expect(isDelete(commitEvent('delete', 'app.test.post'), likeSchema)).toBe(
    false,
  )
})

test('the lexicon accepts a namespace ({ main }) form', () => {
  expect(isPut(commitEvent('update'), { main: likeSchema })).toBe(true)
  expect(
    isPut(commitEvent('update', 'app.test.post'), { main: likeSchema }),
  ).toBe(false)
})

test('the lexicon accepts a bare NSID string', () => {
  expect(isCreate(commitEvent('create'), 'app.test.like')).toBe(true)
  expect(isCreate(commitEvent('create'), 'app.test.post')).toBe(false)
})

test('matching does not validate the record', () => {
  const ev = {
    ...base,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.test.like',
      rkey: '3jt5tlqcwvk24',
      rev: '3jt5tlqcwvk2a',
      cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqrsqxi3jjq3u',
      // not a valid app.test.like record: `subject` is missing
      record: { $type: 'app.test.like' },
    },
  } as TypedEvent
  expect(isCreate(ev, likeSchema)).toBe(true)
})

test('narrows a plain TypedEvent by operation', () => {
  const ev = {} as TypedEvent
  if (isCreate(ev)) {
    expectTypeOf(ev.kind).toEqualTypeOf<'commit'>()
    expectTypeOf(ev.commit.operation).toEqualTypeOf<'create'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<TypedLexMap>()
  }
  if (isPut(ev)) {
    expectTypeOf(ev.commit.operation).toEqualTypeOf<'create' | 'update'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<TypedLexMap>()
  }
  if (isDelete(ev)) {
    expectTypeOf(ev.commit.operation).toEqualTypeOf<'delete'>()
    expectTypeOf(ev.commit).not.toHaveProperty('record')
  }
})

// A record whose $type was wider than the lexicon tightens to the lexicon's
// NSID and stays a lex map, but gains no validated shape — the match did not
// validate. Asserted behaviorally rather than against one exact type: the
// result is lex's `Simplify`-flattened object, not a `TypedLexMap`
// intersection.
test('narrows a plain TypedEvent with a schema: floor-typed record', () => {
  const ev = {} as TypedEvent
  if (isPut(ev, likeSchema)) {
    expectTypeOf(ev.commit.operation).toEqualTypeOf<'create' | 'update'>()
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record.$type).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record).toExtend<TypedLexMap<'app.test.like'>>()
    expectTypeOf(ev.commit.record).not.toEqualTypeOf<Like>()
  }
  if (isDelete(ev, likeSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
  }
})

test('narrows with a bare NSID string like a schema', () => {
  const ev = {} as TypedEvent
  if (isCreate(ev, 'app.test.like')) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record.$type).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record).toExtend<TypedLexMap<'app.test.like'>>()
    expectTypeOf(ev.commit.record).not.toEqualTypeOf<Like>()
  }
})

test('preserves a schema-filtered union arm, including its validated record', () => {
  const ev = {} as TypedEventFor<[typeof likeSchema, 'app.test.post']>
  if (isPut(ev, likeSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<Like>()
  }
  if (isCreate(ev, 'app.test.post')) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.post'>()
    expectTypeOf(ev.commit.record.$type).toEqualTypeOf<'app.test.post'>()
    expectTypeOf(ev.commit.record).toExtend<TypedLexMap<'app.test.post'>>()
  }
})

test('force-narrows a wildcard-filtered arm to the lexicon literal', () => {
  const ev = {} as TypedEventFor<['app.test.*']>
  if (isCreate(ev, likeSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record.$type).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record).toExtend<TypedLexMap<'app.test.like'>>()
    expectTypeOf(ev.commit.record).not.toEqualTypeOf<Like>()
  }
})

test('narrows a record union already on the event down to the lexicon arm', () => {
  const ev = {} as TypedEvent<Post | Like>
  if (isPut(ev, likeSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<Like>()
  }
})

test('narrows a record union whose arms carry non-JSON lex values', () => {
  const ev = {} as TypedEvent<Bytes | Like>
  if (isPut(ev, bytesSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.bytes'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<Bytes>()
  }
})

test('narrows a record union whose arms have optional properties and blobs', () => {
  const ev = {} as TypedEvent<Profile | Like>
  if (isPut(ev, profileSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.profile'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<Profile>()
  }
})

test('floor-types a wide record for a realistic lexicon', () => {
  const ev = {} as TypedEvent
  if (isPut(ev, profileSchema)) {
    expectTypeOf(ev.commit.record.$type).toEqualTypeOf<'app.test.profile'>()
    expectTypeOf(ev.commit.record).toExtend<TypedLexMap<'app.test.profile'>>()
    expectTypeOf(ev.commit.record).not.toEqualTypeOf<Profile>()
  }
})

test('a lexicon foreign to the event record union narrows to never', () => {
  const ev = {} as TypedEvent<Post | Like>
  if (isCreate(ev, 'com.example.other')) {
    expectTypeOf(ev).toBeNever()
  }
})

test('a lexicon foreign to the filtered union narrows to never', () => {
  const ev = {} as TypedEventFor<[typeof likeSchema]>
  if (isCreate(ev, 'com.example.other')) {
    expectTypeOf(ev).toBeNever()
  }
})

test('narrows v1 events, keeping the v1 envelope', () => {
  const ev = {} as TypedEventV1
  if (isPut(ev, likeSchema)) {
    expectTypeOf(ev.timeUs).toEqualTypeOf<number>()
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
  }
  const v1 = {
    did: base.did,
    seq: 1,
    timeUs: 1,
    kind: 'commit',
    commit: commitEvent('create').commit,
  } as TypedEventV1
  expect(isCreate(v1)).toBe(true)
  expect(isDelete(v1)).toBe(false)
})

test('narrows raw events without retyping the raw record', () => {
  const ev = {} as RawEvent
  if (isPut(ev, likeSchema)) {
    expectTypeOf(ev.commit.collection).toEqualTypeOf<'app.test.like'>()
    expectTypeOf(ev.commit.record).toEqualTypeOf<RawRecord>()
  }
  const v1 = {} as RawEventV1
  if (isCreate(v1)) {
    expectTypeOf(v1.commit.operation).toEqualTypeOf<'create'>()
    expectTypeOf(v1.commit.record).toEqualTypeOf<RawRecordJson>()
  }
})
