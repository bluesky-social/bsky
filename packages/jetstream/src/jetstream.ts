import { type DidString } from '@atproto/lex'
import { type JetstreamConsumer } from './consumer.js'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from './engine/collections.js'
import {
  type Account,
  type DeleteCommit,
  type EventBase,
  type EventBatch,
  type Identity,
  type RawEventV1,
  type TypedPutCommit,
} from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventFor } from './filter-types.js'
import { liveEvents } from './live/source.js'
import { type LiveTransport } from './live/transport.js'
import { JetstreamRunner } from './runner.js'
import { shape } from './shape.js'

export interface JetstreamOpts {
  service: string
  /**
   * Strict wire validation. By default the branded string types on events are
   * optimistic — "the server said so." With validateWire: true, every decode
   * boundary checks its wire schema (lex-schema format validators); any
   * violation — including otherwise-skipped malformed frames — throws
   * MalformedError, fatal in every mode.
   */
  validateWire?: boolean
}

export interface LiveOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> {
  collections?: F
  dids?: DidString[]
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
  raw?: boolean
}

// Widest typed event accepted by the impl signature: collection is `string`
// (not narrowed to NsidString) so TypedEventFor<F> is assignable here for any
// CollectionFilter tuple F. record: unknown covers validated and unvalidated.
type WideTypedEvent =
  | (EventBase & {
      kind: 'commit'
      commit: TypedPutCommit<unknown, string> | DeleteCommit<string>
    })
  | (EventBase & { kind: 'identity'; identity: Identity })
  | (EventBase & { kind: 'account'; account: Account })

export class Jetstream {
  readonly service: string
  readonly opts: JetstreamOpts

  constructor(service: string | JetstreamOpts) {
    const opts = typeof service === 'string' ? { service } : service
    this.service = opts.service
    this.opts = opts
  }

  live<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: LiveOpts<F> & { raw?: false },
  ): AsyncGenerator<TypedEventFor<F>>
  live(opts: LiveOpts & { raw: true }): AsyncGenerator<RawEventV1>
  live(opts: LiveOpts = {}): AsyncGenerator<RawEventV1 | WideTypedEvent> {
    const { schemasByNsid } = parseCollectionFilters(opts.collections ?? [])
    return shape(this.liveRawBatches(opts), opts, schemasByNsid, opts.onError)
  }

  runner(consumer: JetstreamConsumer): JetstreamRunner {
    return new JetstreamRunner(this, consumer)
  }

  // The raw batch stream underlying live(); the runner drives it directly.
  // Each event is wrapped in a trivial single-event "batch" with NO extra
  // buffering — live delivery stays realtime. EventBatch is used only as the
  // standard internal interface, looking ahead to v2 modes (snapshot/replay)
  // where batches carry real grouping.
  async *liveRawBatches(
    opts: LiveOpts,
  ): AsyncGenerator<EventBatch<RawEventV1>> {
    const host = this.service
    const { nsids } = parseCollectionFilters(opts.collections ?? [])
    const start = await opts.cursor?.load()
    for await (const ev of liveEvents({
      host,
      collections: nsids,
      dids: opts.dids,
      cursor: start,
      dedupFloor: start, // a resume cursor is also the dedup floor
      transport: opts.liveTransport,
      signal: opts.signal,
      onError: opts.onError,
      validateWire: this.opts.validateWire,
    })) {
      yield { events: [ev], lastCursor: ev.seq }
    }
  }
}
