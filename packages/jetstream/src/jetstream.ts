import { defaultRuntime } from '#runtime'
import { type DidString } from '@atproto/lex'
import { assertValidApiKey, bearerAuth, withBearer } from './auth.js'
import { type JetstreamConsumer } from './consumer.js'
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
import {
  type LiveTransport,
  type LiveTransportHeaders,
} from './live/transport.js'
import { type RawRecordCbor, type RawRecordJson } from './raw-record.js'
import { JetstreamRunner } from './runner.js'
import { type Decompressor, type Sha256 } from './runtime/interface.js'
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
   * API key sent as `Authorization: Bearer <apiKey>` on every request —
   * snapshot downloads and the live websocket handshake alike. A request
   * that already carries an Authorization header keeps it. Validated at
   * construction: an absent key is legal (no auth sent); a present-but-
   * malformed one is not.
   */
  apiKey?: string
  /**
   * fetch used for snapshot downloads (planSnapshot/getSegment/getBlock) by
   * snapshot() and replay(). Defaults to the global fetch.
   */
  fetchImpl?: typeof fetch
  /**
   * Retry policy for snapshot downloads. Defaults to unbounded full-jitter
   * exponential backoff on transient failures (see RetryPolicy).
   */
  retry?: RetryPolicy
  /**
   * Approximate per-download buffer budget for snapshot downloads, in bytes.
   * Default 64 MiB, split between the download being delivered and the
   * prefetched ones behind it. Total snapshot memory scales with this and
   * blockConcurrency.
   */
  snapshotBufferBytes?: number
  /** Concurrent block downloads while snapshotting. Default 4. */
  blockConcurrency?: number
  /**
   * zstd decompressor for snapshot blocks. Wins over the platform default
   * (node:zlib via the `#runtime` imports condition; browsers have none and
   * must supply one to use snapshot()/replay()).
   */
  decompressor?: Decompressor
  /**
   * Synchronous SHA-256 backing the lazy `cid` getter on snapshot put
   * commits. Wins over the platform default (node:crypto via the `#runtime`
   * imports condition; browsers have none and must supply one to use
   * snapshot()/replay()).
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
   * wire, applied client-side over the snapshot phase.
   */
  kinds?: Kind[]
  /**
   * Resume position source. `afterSeq` wins when both are set. replay() only
   * loads from the store — saving is the runner's job.
   */
  cursor?: CursorStore
  /** Exclusive lower bound for the snapshot phase. */
  afterSeq?: number
  /** Caps the snapshot phase only; the live tail is unbounded. */
  beforeSeq?: number
  signal?: AbortSignal
  /**
   * Recoverable problems from either phase: a DownloadError per re-planned
   * transient failure, a RecordValidationError per skipped record in typed
   * mode, and live-tail advisories (e.g. #info frames).
   */
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
  /**
   * Bound on recovery re-plans (transient download failures plus
   * cursor-too-old recoveries) before replay gives up and throws. Default 50.
   */
  maxReplans?: number
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
  maxReplans?: number
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
    // Fail fast on a malformed key: deferring the check to request time
    // either leaks the key into a thrown message or silently disables auth.
    if (opts.apiKey !== undefined) assertValidApiKey(opts.apiKey)
    this.service = opts.service
    this.opts = opts
  }

  // Resolved per call, not cached, so fetch/apiKey are read at use time.
  #resolveFetch(): typeof fetch {
    const base = this.opts.fetchImpl ?? fetch
    return this.opts.apiKey ? withBearer(base, this.opts.apiKey) : base
  }

  // Never returns an object with an undefined value — LiveTransportHeaders
  // rejects that at the type level (it would normalize to the wire string
  // "undefined").
  #authHeaders(): LiveTransportHeaders | undefined {
    return this.opts.apiKey
      ? { authorization: bearerAuth(this.opts.apiKey) }
      : undefined
  }

  // The public budget split half-and-half between the delivered download and
  // the prefetched ones (the internal scheduler takes separate bounds).
  #snapshotHwm(): { outstandingHwmBytes: number; tailHwmBytes: number } {
    const budget = this.opts.snapshotBufferBytes ?? 64 * 1024 * 1024
    if (!(budget > 0)) {
      throw new RangeError('snapshotBufferBytes must be > 0')
    }
    const half = Math.ceil(budget / 2)
    return { outstandingHwmBytes: half, tailHwmBytes: half }
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
  // Snapshot-phase batches carry the CBOR record arm, live-tail batches the
  // JSON arm (discriminate with `record instanceof Uint8Array`).
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
      ...this.#snapshotHwm(),
      blockConcurrency: this.opts.blockConcurrency,
      fetchImpl: this.#resolveFetch(),
      decompressor: this.opts.decompressor ?? defaultRuntime.zstdDecompressor(),
      sha256: this.opts.sha256 ?? defaultRuntime.sha256(),
      transport: opts.liveTransport,
      headers: this.#authHeaders(),
      signal: opts.signal,
      onError: opts.onError,
      maxReplans: opts.maxReplans,
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
    return rawBatchStream(
      this.service,
      { ...opts, headers: this.#authHeaders() },
      2,
      this.opts.validateWire,
    )
  }

  // The raw batch stream underlying snapshot(); the runner drives it
  // directly. One batch per snapshot block, in strict seq order.
  async *snapshotRawBatches(
    opts: SnapshotOpts,
  ): AsyncGenerator<EventBatch<RawEvent<RawRecordCbor>>> {
    const host = this.service
    const signal = opts.signal
    if (signal?.aborted) return
    const fetchImpl = this.#resolveFetch()
    // Resolved before any network work; on a runtime with no defaults this
    // throws here, at the first pull, with a supply-your-own message.
    const decompressor =
      this.opts.decompressor ?? defaultRuntime.zstdDecompressor()
    const sha256 = this.opts.sha256 ?? defaultRuntime.sha256()
    const { nsids } = parseCollectionFilters(opts.collections ?? [])
    const maxReplans = opts.maxReplans ?? 50

    // afterSeq wins; otherwise resume from the cursor store. lastEmitted
    // tracks the max EventBatch.lastCursor yielded. A DownloadError re-plans
    // the residual (lastEmitted, tip]: a block straddling the boundary is
    // planned whole (the plan is one-sided), and the selector's seq window —
    // advanced to each re-plan's floor — prunes the already-delivered rows,
    // so recovery has no gap and no duplicate. Decode errors are terminal;
    // abort returns cleanly.
    let resume = opts.afterSeq ?? (await opts.cursor?.load()) ?? 0
    let lastEmitted = resume
    let replans = 0
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
            ...this.#snapshotHwm(),
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
        replans++
        // Anti-spin: bound the number of re-plans. A transient failure before
        // any batch is emitted keeps resume pinned, so termination cannot key
        // on resume-not-advancing (that would defeat recovering a
        // fail-once-at-seq-0 download); the maxReplans bound terminates an
        // always-failing download instead.
        if (replans > maxReplans) {
          throw new Error(
            `jetstream: snapshot re-plan made no progress (resume=${resume} prev=${prevResume} cycles=${replans})`,
            { cause: err },
          )
        }
      }
    }
  }
}
