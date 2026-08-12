import type {
  AtUriString,
  DatetimeString,
  DidString,
  HandleString,
  NsidString,
} from '@atproto/lex'
import { expectTypeOf, test } from 'vitest'
import type { CollectionFilter } from '../src/engine/collections.js'
import type {
  Identity,
  RawEventV1,
  RawPutCommitV1,
  TypedEvent,
} from '../src/event.js'
import type { LiveOpts } from '../src/jetstream.js'
import type { IdentityEvent, PutEvent } from '../src/lex-indexer.js'

test('event envelope fields carry lex string format brands', () => {
  expectTypeOf<RawEventV1['did']>().toEqualTypeOf<DidString>()
  expectTypeOf<RawPutCommitV1['collection']>().toEqualTypeOf<NsidString>()
  expectTypeOf<Identity['handle']>().toEqualTypeOf<HandleString | undefined>()
  expectTypeOf<Identity['time']>().toEqualTypeOf<DatetimeString | undefined>()
})

test('typed commits inherit the branded collection default', () => {
  type Commit = Extract<TypedEvent, { kind: 'commit' }>['commit']
  expectTypeOf<Commit['collection']>().toEqualTypeOf<NsidString>()
})

test('a plain string does not satisfy the branded fields', () => {
  expectTypeOf<string>().not.toMatchTypeOf<DidString>()
  expectTypeOf<string>().not.toMatchTypeOf<NsidString>()
  // free aliases intentionally accept plain string
  expectTypeOf<string>().toMatchTypeOf<RawPutCommitV1['cid']>()
  expectTypeOf<string>().toMatchTypeOf<RawPutCommitV1['rkey']>()
})

test('indexer handler events carry brands', () => {
  expectTypeOf<PutEvent<unknown>['uri']>().toEqualTypeOf<AtUriString>()
  expectTypeOf<PutEvent<unknown>['did']>().toEqualTypeOf<DidString>()
  expectTypeOf<PutEvent<unknown>['collection']>().toEqualTypeOf<NsidString>()
  expectTypeOf<IdentityEvent['handle']>().toEqualTypeOf<
    HandleString | undefined
  >()
})

test('dids input demands DidString; literals satisfy it structurally', () => {
  expectTypeOf<['did:plc:abc']>().toMatchTypeOf<NonNullable<LiveOpts['dids']>>()
  expectTypeOf<string[]>().not.toMatchTypeOf<NonNullable<LiveOpts['dids']>>()
})

test('collection filter string arm: NSIDs and wildcards pass, junk rejected', () => {
  expectTypeOf<'app.bsky.feed.like'>().toMatchTypeOf<CollectionFilter>()
  expectTypeOf<'app.bsky.feed.*'>().toMatchTypeOf<CollectionFilter>()
  expectTypeOf<'foo.bar'>().not.toMatchTypeOf<CollectionFilter>()
  expectTypeOf<string>().not.toMatchTypeOf<CollectionFilter>()
})
