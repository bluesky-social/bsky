import { type DidString } from '@atproto/lex'
import { type JetstreamConsumer } from './consumer.js'
import { type Sha256, nodeSha256 } from './decode-event.js'
import { backfillBatches } from './engine/backfill-pipeline.js'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from './engine/collections.js'
import { planPages } from './engine/planner.js'
import { makeSelector } from './engine/selector.js'
import { type EventBatch, type Kind, type RawEvent } from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventFor, type WideTypedEvent } from './filter-types.js'
import { cutoverReplay } from './live/cutover.js'
import { rawBatchStream } from './live/pipeline.js'
import { type LiveTransport } from './live/transport.js'
import { type RawRecordCbor, type RawRecordJson } from './raw-record.js'
import { JetstreamRunner } from './runner.js'
import { type Decompressor, nodeDecompressor } from './segment/decompressor.js'
import { shape } from './shape.js'
import { DownloadError } from './xrpc/errors.js'
import { type RetryPolicy } from './xrpc/retry.js'

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
  /**
   * fetch used for archive requests (planSnapshot/getSegment/getBlock) by
   * snapshot() and replay(). Defaults to the global fetch.
   */
  fetchImpl?: typeof fetch
  /**
   * Retry policy for archive downloads. Defaults to unbounded full-jitter
   * exponential backoff on transient failures (see RetryPolicy).
   */
  retry?: RetryPolicy
  /** Byte high-water mark for the head archive download. Default 32 MiB. */
  outstandingHwmBytes?: number
  /** Byte high-water mark per prefetched archive download. Default 32 MiB. */
  tailHwmBytes?: number
  /** Concurrent block downloads during archive backfill. Default 4. */
  blockConcurrency?: number
  /**
   * zstd decompressor for archive blocks. Defaults to node:zlib, loaded
   * lazily on first snapshot()/replay(); non-Node runtimes must supply one —
   * there is no fallback.
   */
  decompressor?: Decompressor
  /**
   * Synchronous SHA-256 backing the lazy `cid` getter on archive put commits.
   * Defaults to node:crypto, loaded lazily on first snapshot()/replay();
   * non-Node runtimes must supply one — there is no fallback.
   */
  sha256?: Sha256
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
  /**
   * Seq-less server advisories (`#info` frames, e.g. `OutdatedCursor`). Not
   * an error: when omitted, an advisory is dropped silently rather than
   * routed to onError.
   */
  onInfo?: (info: { name: string; message?: string }) => void
  liveTransport?: LiveTransport
  raw?: boolean
}

export interface ReplayOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> {
  collections?: F
  dids?: DidString[]
  /**
   * Event kinds to receive, uniform across both phases: sent on the live
   * wire, applied client-side over the archive backfill.
   */
  kinds?: Kind[]
  /**
   * Resume position source. `afterSeq` wins when both are set. replay() only
   * loads from the store — saving is the runner's job.
   */
  cursor?: CursorStore
  /** Exclusive lower bound for the backfill phase. */
  afterSeq?: number
  /** Caps the backfill phase only; the live tail is unbounded. */
  beforeSeq?: number
  signal?: AbortSignal
  /** Recoverable backfill problems (DownloadError, RecordValidationError). */
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
  /** Recoverable live-tail advisories (e.g. #info frames). */
  onLiveError?: (err: Error) => void
  /**
   * Bound on recovery cycles (download-failure re-plans plus cursor-too-old
   * re-backfills) before replay gives up and throws. Default 50.
   */
  maxRebackfills?: number
  raw?: boolean
}

export interface SnapshotOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> {
  collections?: F
  dids?: DidString[]
  /**
   * Resume position source. `afterSeq` wins when both are set. snapshot()
   * only loads from the store — saving is the runner's job.
   */
  cursor?: CursorStore
  /** Exclusive lower bound: events at or below it are not included. */
  afterSeq?: number
  /** Inclusive upper bound; also caps the pinned sealed tip. */
  beforeSeq?: number
  signal?: AbortSignal
  /**
   * Recoverable problems: a DownloadError per re-planned transient failure
   * (its `.entry` names the segment), and a RecordValidationError per skipped
   * record in typed mode. Fatal problems throw instead.
   */
  onError?: (err: Error) => void
  /**
   * Bound on download-failure re-plans before the snapshot gives up and
   * throws. Default 50.
   */
  maxRebackfills?: number
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

  snapshot<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: SnapshotOpts<F> & { raw?: false },
  ): AsyncGenerator<TypedEventFor<F>>
  snapshot(
    opts: SnapshotOpts & { raw: true },
  ): AsyncGenerator<RawEvent<RawRecordCbor>>
  snapshot(
    opts: SnapshotOpts = {},
  ): AsyncGenerator<RawEvent<RawRecordCbor> | WideTypedEvent> {
    const { schemasByNsid } = parseCollectionFilters(opts.collections ?? [])
    return shape(
      this.snapshotRawBatches(opts),
      { ...opts, validateWire: this.opts.validateWire },
      schemasByNsid,
      opts.onError,
    ) as AsyncGenerator<RawEvent<RawRecordCbor> | WideTypedEvent>
  }

  replay<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: ReplayOpts<F> & { raw?: false },
  ): AsyncGenerator<TypedEventFor<F>>
  replay(opts: ReplayOpts & { raw: true }): AsyncGenerator<RawEvent>
  replay(opts: ReplayOpts = {}): AsyncGenerator<RawEvent | WideTypedEvent> {
    const { schemasByNsid } = parseCollectionFilters(opts.collections ?? [])
    return shape(
      this.replayRawBatches(opts),
      { ...opts, validateWire: this.opts.validateWire },
      schemasByNsid,
      opts.onError,
    ) as AsyncGenerator<RawEvent | WideTypedEvent>
  }

  runner(consumer: JetstreamConsumer): JetstreamRunner {
    return new JetstreamRunner(this, consumer)
  }

  // The raw batch stream underlying replay(); the runner drives it directly.
  // Archive batches carry the CBOR record arm, live-tail batches the JSON arm
  // (discriminate with `record instanceof Uint8Array`).
  async *replayRawBatches(
    opts: ReplayOpts,
  ): AsyncGenerator<EventBatch<RawEvent>> {
    const { nsids } = parseCollectionFilters(opts.collections ?? [])
    const afterSeq = opts.afterSeq ?? (await opts.cursor?.load())
    yield* cutoverReplay({
      host: this.service,
      nsids,
      dids: opts.dids,
      kinds: opts.kinds,
      afterSeq,
      beforeSeq: opts.beforeSeq,
      outstandingHwmBytes: this.opts.outstandingHwmBytes,
      tailHwmBytes: this.opts.tailHwmBytes,
      blockConcurrency: this.opts.blockConcurrency,
      fetchImpl: this.opts.fetchImpl ?? fetch,
      decompressor: this.opts.decompressor ?? (await nodeDecompressor()),
      sha256: this.opts.sha256 ?? (await nodeSha256()),
      transport: opts.liveTransport,
      signal: opts.signal,
      onError: opts.onError,
      onLiveError: opts.onLiveError,
      maxRebackfills: opts.maxRebackfills,
      retry: this.opts.retry,
      validateWire: this.opts.validateWire,
    })
  }

  // The raw batch stream underlying live(); the runner drives it directly.
  // Each event is wrapped in a trivial single-event "batch" with NO extra
  // buffering — live delivery stays realtime. EventBatch is used only as the
  // standard internal interface; snapshot/replay batches carry real grouping.
  liveRawBatches(
    opts: LiveOpts,
  ): AsyncGenerator<EventBatch<RawEvent<RawRecordJson>>> {
    return rawBatchStream(this.service, opts, 2, this.opts.validateWire)
  }

  // The raw batch stream underlying snapshot(); the runner drives it
  // directly. One batch per archive block, in strict seq order.
  async *snapshotRawBatches(
    opts: SnapshotOpts,
  ): AsyncGenerator<EventBatch<RawEvent<RawRecordCbor>>> {
    const host = this.service
    const signal = opts.signal
    if (signal?.aborted) return
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const decompressor = this.opts.decompressor ?? (await nodeDecompressor())
    const sha256 = this.opts.sha256 ?? (await nodeSha256())
    const { nsids } = parseCollectionFilters(opts.collections ?? [])
    const maxRebackfills = opts.maxRebackfills ?? 50

    // afterSeq wins; otherwise resume from the cursor store. lastEmitted
    // tracks the max EventBatch.lastCursor yielded. A DownloadError re-plans
    // the residual (lastEmitted, tip]: a block straddling the boundary is
    // planned whole (the plan is one-sided), and the selector's seq window —
    // advanced to each re-plan's floor — prunes the already-delivered rows,
    // so recovery has no gap and no duplicate. Decode errors are terminal;
    // abort returns cleanly.
    let resume = opts.afterSeq ?? (await opts.cursor?.load()) ?? 0
    let lastEmitted = resume
    let rebackfills = 0
    const window = { afterSeq: resume, beforeSeq: opts.beforeSeq }
    const selector = makeSelector({
      dids: opts.dids,
      collections: nsids,
      window,
    })

    for (;;) {
      if (signal?.aborted) return
      try {
        for await (const page of planPages({
          host,
          dids: opts.dids,
          collections: nsids,
          afterSeq: resume,
          beforeSeq: opts.beforeSeq,
          fetchImpl,
          signal,
        })) {
          for await (const batch of backfillBatches({
            host,
            entries: page.segments,
            selector,
            outstandingHwmBytes: this.opts.outstandingHwmBytes,
            tailHwmBytes: this.opts.tailHwmBytes,
            blockConcurrency: this.opts.blockConcurrency,
            fetchImpl,
            decompressor,
            sha256,
            signal,
            retry: this.opts.retry,
            validateWire: this.opts.validateWire,
          })) {
            if (batch.lastCursor > lastEmitted) lastEmitted = batch.lastCursor
            yield batch
          }
        }
        return
      } catch (err) {
        if (signal?.aborted) return
        if (!(err instanceof DownloadError)) throw err
        opts.onError?.(err)
        const prevResume = resume
        resume = Math.max(lastEmitted, resume)
        window.afterSeq = resume // prune re-planned rows already delivered
        rebackfills++
        // Anti-spin: bound the number of re-plans. A transient failure before
        // any batch is emitted keeps resume pinned, so termination cannot key
        // on resume-not-advancing (that would defeat recovering a
        // fail-once-at-seq-0 download); the maxRebackfills bound terminates
        // an always-failing download instead.
        if (rebackfills > maxRebackfills) {
          throw new Error(
            `jetstream: backfill re-plan made no progress (resume=${resume} prev=${prevResume} cycles=${rebackfills})`,
            { cause: err },
          )
        }
      }
    }
  }
}
