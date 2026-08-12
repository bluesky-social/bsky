import { type DidString } from '@atproto/lex'
import { type JetstreamConsumer } from './consumer.js'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from './engine/collections.js'
import { type EventBatch, type RawEventV1 } from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventForV1, type WideTypedEventV1 } from './filter-types.js'
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
  ): AsyncGenerator<TypedEventForV1<F>>
  live(opts: LiveOpts & { raw: true }): AsyncGenerator<RawEventV1>
  live(opts: LiveOpts = {}): AsyncGenerator<RawEventV1 | WideTypedEventV1> {
    const { schemasByNsid } = parseCollectionFilters(opts.collections ?? [])
    // shape() is version-generic (one implementation serves both wires); this
    // Jetstream is v1-backed, so its output is honestly RawEventV1 |
    // WideTypedEventV1 at runtime even though shape()'s declared return type
    // covers both wires' possibilities.
    return shape(
      this.liveRawBatches(opts),
      { ...opts, validateWire: this.opts.validateWire },
      schemasByNsid,
      opts.onError,
    ) as AsyncGenerator<RawEventV1 | WideTypedEventV1>
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
      version: 1, // TEMPORARY: removed in the task that flips Jetstream to v2
    })) {
      yield { events: [ev], lastCursor: ev.seq }
    }
  }
}
