import { l, record } from '@atproto/lex'
import { expect, expectTypeOf, test } from 'vitest'
import type { JetstreamConsumer, SpacesConsumer } from '../../src/consumer.js'
import type {
  JetstreamProgress,
  Kind,
  RawEvent,
  RawSpacesEvent,
  SpacesKind,
  TypedEvent,
} from '../../src/event.js'
import type {
  TypedEventFor,
  TypedSpacesEventFor,
} from '../../src/filter-types.js'
import { Jetstream, type JetstreamOpts } from '../../src/jetstream.js'
import { LexIndexer } from '../../src/lex-indexer.js'
import type { RawRecordCbor } from '../../src/raw-record.js'
import type { JetstreamRunner } from '../../src/runner.js'

// Type assertions, checked by `tsc --build tsconfig.json`. The bodies only
// construct clients and generators; nothing touches the network.
const note = record('tid', 'app.example.note', l.object({ text: l.string() }))
const filters = [note] as const

test('existing public code keeps its types', () => {
  const fromString = new Jetstream('https://jetstream.example')
  const opts: JetstreamOpts = { service: 'https://jetstream.example' }
  const fromVar = new Jetstream(opts)
  expectTypeOf(fromString).toEqualTypeOf<Jetstream>()
  expectTypeOf(fromVar).toEqualTypeOf<Jetstream>()
  const viaInstanceType: Jetstream = {} as InstanceType<typeof Jetstream>
  const indexerViaInstanceType: LexIndexer = {} as InstanceType<
    typeof LexIndexer
  >
  void viaInstanceType
  void indexerViaInstanceType

  // Event unions are unchanged: an exhaustive switch still type-checks.
  const kindOf = (ev: TypedEvent): string => {
    switch (ev.kind) {
      case 'commit':
      case 'identity':
      case 'account':
      case 'sync':
        return ev.kind
      default: {
        const never: never = ev
        return never
      }
    }
  }
  void kindOf
  const handlers: Record<Kind, () => void> = {
    commit: () => {},
    identity: () => {},
    account: () => {},
    sync: () => {},
  }
  void handlers

  expectTypeOf(fromString.live({ collections: filters })).toEqualTypeOf<
    AsyncGenerator<TypedEventFor<typeof filters>>
  >()
  expectTypeOf(fromString.snapshot({ raw: true })).toEqualTypeOf<
    AsyncGenerator<RawEvent<RawRecordCbor>>
  >()
  expectTypeOf(fromString.replay({ raw: true })).toEqualTypeOf<
    AsyncGenerator<RawEvent>
  >()

  const consumer = {} as JetstreamConsumer
  expectTypeOf(fromString.runner(consumer)).toEqualTypeOf<JetstreamRunner>()
  expectTypeOf(new LexIndexer().kinds).toEqualTypeOf<Kind[] | undefined>()
  new LexIndexer().commit(note, {
    put: (e) => {
      expectTypeOf(e.record.text).toBeString()
      expectTypeOf(e).not.toHaveProperty('space')
    },
  })

  // @ts-expect-error progress is Spaces-only
  void fromString.live({ progress: true })
  // @ts-expect-error scope events are Spaces-only
  void new LexIndexer().scope(() => {})
  // @ts-expect-error the public filter has no scope kind
  void fromString.live({ kinds: ['scope'] })
})

test('Spaces mode is explicit and typed', () => {
  const js = new Jetstream({
    service: 'https://archive.example',
    mode: 'spaces',
  })
  expectTypeOf(js).toEqualTypeOf<Jetstream<'spaces'>>()
  // @ts-expect-error a Spaces client is not a public client
  const asPublic: Jetstream = js
  void asPublic

  expectTypeOf(js.live({ collections: filters })).toEqualTypeOf<
    AsyncGenerator<TypedSpacesEventFor<typeof filters>>
  >()
  for (const ev of [] as Array<TypedSpacesEventFor<typeof filters>>) {
    if (ev.kind === 'commit')
      expectTypeOf(ev.space).toEqualTypeOf<string | undefined>()
    if (ev.kind === 'identity')
      expectTypeOf(ev.space).toEqualTypeOf<undefined>()
    if (ev.kind === 'scope') {
      expectTypeOf(ev.space).toBeString()
      if (ev.scope.operation === 'repoRemoved')
        expectTypeOf(ev.scope.did).toBeString()
    }
  }
  expectTypeOf(js.replay({ raw: true, progress: true })).toEqualTypeOf<
    AsyncGenerator<RawSpacesEvent | JetstreamProgress>
  >()
  void js.live({ kinds: ['scope', 'commit'] })

  const ix = new LexIndexer({ mode: 'spaces' }).scope((e) => {
    expectTypeOf(e.space).toBeString()
  })
  expectTypeOf(ix.kinds).toEqualTypeOf<SpacesKind[] | undefined>()
  const asConsumer: SpacesConsumer = ix
  void asConsumer
  expectTypeOf(js.runner(ix)).toEqualTypeOf<JetstreamRunner<'spaces'>>()
  const publicIndexer = new LexIndexer()
  // @ts-expect-error a Spaces runner needs a Spaces consumer
  expect(() => js.runner(publicIndexer)).toThrow(TypeError)
})
