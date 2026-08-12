import { type DidString } from '@atproto/lex'
import { type JetstreamConsumer } from './consumer.js'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from './engine/collections.js'
import { type EventBatch, type Kind, type RawEvent } from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventFor, type WideTypedEvent } from './filter-types.js'
import { rawBatchStream } from './live/pipeline.js'
import { type LiveTransport } from './live/transport.js'
import { type RawRecordJson } from './raw-record.js'
import { JetstreamRunner } from './runner.js'
import { shape } from './shape.js'

export interface JetstreamOpts {
  service: string
  /**
   * Strict wire validation. By default the branded string types on events are
   * optimistic — "the server said so." With validateWire: true, every decode
   * boundary checks its wire schema (lex-schema format validators).
   *
   * The two boundaries this touches fail differently. A wire-FRAME violation
   * (a malformed envelope, otherwise silently skipped) throws MalformedError,
   * fatal in every mode. A RECORD-conversion violation — a put commit's
   * record failing to convert to lex data or failing schema validation — is
   * never fatal: it is reported per record (via the per-call `onError`, or
   * `LexIndexer`'s `onValidationError`) and that one event is skipped.
   *
   * Note: `runner()`'s stream (`LexIndexer` over `liveRawBatches()`) gets
   * strict wire decode from this flag, but never strict record conversion —
   * `LexIndexer.run` calls `typedEventFromRaw` with no `opts`, so record
   * conversion there is always non-strict regardless of `validateWire`.
   */
  validateWire?: boolean
}

export interface LiveOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> {
  collections?: F
  dids?: DidString[]
  /**
   * Event kinds to receive. Omitted means all kinds. The collections filter
   * constrains only commits, so a commits-only stream needs kinds: ['commit'].
   */
  kinds?: Kind[]
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
  raw?: boolean
}

/**
 * A Jetstream instance speaking the v2 wire
 * (`/xrpc/network.bsky.jetstream.subscribeEvents`). Live streaming via
 * `live()`, plus `runner()` for indexer-driven consumption. Cursors are `seq`
 * values — not portable to or from a v1 host (see `JetstreamV1`).
 */
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
  live(opts: LiveOpts & { raw: true }): AsyncGenerator<RawEvent<RawRecordJson>>
  live(
    opts: LiveOpts = {},
  ): AsyncGenerator<RawEvent<RawRecordJson> | WideTypedEvent> {
    const { schemasByNsid } = parseCollectionFilters(opts.collections ?? [])
    // shape() is version-generic (one implementation serves both wires); this
    // Jetstream is v2-backed, so its output is honestly RawEvent<RawRecordJson>
    // | WideTypedEvent at runtime even though shape()'s declared return type
    // covers both wires' possibilities.
    return shape(
      this.liveRawBatches(opts),
      { ...opts, validateWire: this.opts.validateWire },
      schemasByNsid,
      opts.onError,
    ) as AsyncGenerator<RawEvent<RawRecordJson> | WideTypedEvent>
  }

  runner(consumer: JetstreamConsumer): JetstreamRunner {
    return new JetstreamRunner(this, consumer)
  }

  // The raw batch stream underlying live(); the runner drives it directly.
  // Each event is wrapped in a trivial single-event "batch" with NO extra
  // buffering — live delivery stays realtime. EventBatch is used only as the
  // standard internal interface, looking ahead to v2 modes (snapshot/replay)
  // where batches carry real grouping.
  liveRawBatches(
    opts: LiveOpts,
  ): AsyncGenerator<EventBatch<RawEvent<RawRecordJson>>> {
    return rawBatchStream(
      this.service,
      opts,
      2,
      this.opts.validateWire,
    ) as AsyncGenerator<EventBatch<RawEvent<RawRecordJson>>>
  }
}
