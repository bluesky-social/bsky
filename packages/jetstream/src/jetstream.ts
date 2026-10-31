import { defaultRuntime } from '#runtime'
import { type DidString } from '@atproto/lex'
import { assertValidApiKey, bearerAuth, withBearer } from './auth.js'
import { type JetstreamConsumer, type SpacesConsumer } from './consumer.js'
import { backfillBatches } from './engine/backfill-pipeline.js'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from './engine/collections.js'
import { planPages } from './engine/planner.js'
import { makeSelector } from './engine/selector.js'
import {
  type EventBatch,
  type JetstreamMode,
  type JetstreamProgress,
  type Kind,
  type RawEvent,
  type RawSpacesEvent,
  type SpacesEventBatch,
  type SpacesKind,
} from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventFor, type TypedSpacesEventFor } from './filter-types.js'
import { cutoverReplay } from './live/cutover.js'
import { rawBatchStream } from './live/pipeline.js'
import { Coverage } from './live/source.js'
import {
  type LiveTransport,
  type LiveTransportHeaders,
} from './live/transport.js'
import { type RawRecordCbor, type RawRecordJson } from './raw-record.js'
import { JetstreamRunner } from './runner.js'
import { type Decompressor, type Sha256 } from './runtime/interface.js'
import { shape } from './shape.js'
import { DownloadError } from './xrpc/errors.js'
import {
  type SpacesProtocol,
  negotiateSpacesProtocol,
} from './xrpc/protocol.js'
import { type RetryPolicy } from './xrpc/retry.js'

export interface JetstreamOpts<M extends JetstreamMode = 'public'> {
  service: string
  /**
   * The data contract (default `'public'`: the public Jetstream wire,
   * unchanged). `'spaces'` selects a space-sync archive explicitly: every
   * consumption operation first discovers the server's capabilities
   * (getCapabilities), selects Spaces protocol 2, sends `protocolVersion` on
   * every request and verifies the negotiated response headers. It never
   * falls back to the public contract. Spaces events carry `space` and
   * include `scope` markers; archive format 2 is decoded.
   */
  mode?: M
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
   * constrains only commits, so a commits-only stream needs kinds: ['commit'] —
   * and conversely, a kinds list without 'commit' makes a collections filter
   * unsatisfiable and is rejected rather than silently ignored.
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
   * Event kinds to receive, uniform across both phases: sent on the live wire
   * and to the snapshot planner, then re-applied client-side (the plan only
   * narrows which blocks are downloaded).
   *
   * Note the interaction with `collections`, which constrains commits only: a
   * `kinds` list without `'commit'` makes a collections filter unsatisfiable
   * and is rejected rather than silently ignored.
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
   * transient failure, and a RecordValidationError per skipped record in
   * typed mode.
   */
  onError?: (err: Error) => void
  /**
   * Seq-less server advisories from the live phase (`#info` frames, e.g.
   * `OutdatedCursor`). Not an error: when omitted, an advisory is dropped
   * silently rather than routed to onError.
   */
  onInfo?: (info: { name: string; message?: string }) => void
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
   * Event kinds to receive. Sent to the planner so whole blocks can be skipped
   * before download, then re-applied client-side (the plan may still ship
   * other kinds from a selected block).
   *
   * Note the interaction with `collections`, which constrains commits only: a
   * `kinds` list without `'commit'` makes a collections filter unsatisfiable
   * and is rejected rather than silently ignored.
   */
  kinds?: Kind[]
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

// Spaces options: the public options with the fifth kind, plus opt-in
// ordered progress. Separate interfaces so the public option types — and
// every public call site — stay exactly as they were.
interface SpacesExtras {
  /** Event kinds to receive; `scope` included. Omitted means all kinds. */
  kinds?: SpacesKind[]
  /**
   * Opt into ordered coverage. Live: sends progress=true and requires the
   * Jetstream-Progress acknowledgement on every connection. Archive: each
   * fully delivered plan page certifies through its plannedThroughSeq
   * (caughtUp false). Iterators then also yield JetstreamProgress values,
   * raw batch streams carry them as `batch.progress`, and the runner
   * checkpoints them once every earlier event is acked.
   */
  progress?: boolean
}
export interface SpacesLiveOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
>
  extends Omit<LiveOpts<F>, 'kinds'>, SpacesExtras {}
export interface SpacesReplayOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
>
  extends Omit<ReplayOpts<F>, 'kinds'>, SpacesExtras {}
export interface SpacesSnapshotOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
>
  extends Omit<SnapshotOpts<F>, 'kinds'>, SpacesExtras {}

// Mode-selected types. Non-distributive on purpose: an instance whose mode
// is not statically 'spaces' (including Jetstream<JetstreamMode>, e.g. via
// InstanceType) keeps the public types.
type IsSpaces<M extends JetstreamMode> = [M] extends ['spaces'] ? true : false
// The mode an instance actually has in its types: an unresolved mode is
// public, so InstanceType<typeof Jetstream> stays assignable to Jetstream.
type ModeOf<M extends JetstreamMode> =
  IsSpaces<M> extends true ? 'spaces' : 'public'
type LiveOptsFor<
  M extends JetstreamMode,
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> = IsSpaces<M> extends true ? SpacesLiveOpts<F> : LiveOpts<F>
type ReplayOptsFor<
  M extends JetstreamMode,
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> = IsSpaces<M> extends true ? SpacesReplayOpts<F> : ReplayOpts<F>
type SnapshotOptsFor<
  M extends JetstreamMode,
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> = IsSpaces<M> extends true ? SpacesSnapshotOpts<F> : SnapshotOpts<F>
// Spaces call sites without progress may say `progress: false`; public call
// sites gain no new key.
type NoProgress<M extends JetstreamMode> =
  IsSpaces<M> extends true ? { progress?: false } : unknown
type TypedFor<M extends JetstreamMode, F extends readonly CollectionFilter[]> =
  IsSpaces<M> extends true ? TypedSpacesEventFor<F> : TypedEventFor<F>
type RawFor<
  M extends JetstreamMode,
  T extends RawRecordCbor | RawRecordJson = RawRecordCbor | RawRecordJson,
> = IsSpaces<M> extends true ? RawSpacesEvent<T> : RawEvent<T>
type BatchFor<M extends JetstreamMode, E> =
  IsSpaces<M> extends true ? SpacesEventBatch<E> : EventBatch<E>
/** The consumer a runner of this mode drives. */
export type ConsumerFor<M extends JetstreamMode> =
  IsSpaces<M> extends true ? SpacesConsumer : JetstreamConsumer

/**
 * A Jetstream instance speaking the v2 wire
 * (`/xrpc/network.bsky.jetstream.subscribeEvents`). Live streaming via
 * `live()`, plus `runner()` for indexer-driven consumption. Cursors are `seq`
 * values — not portable to or from a v1 host (see `JetstreamV1`).
 *
 * `new Jetstream(url)` and `new Jetstream({ service })` are the public
 * contract, unchanged. `new Jetstream({ service, mode: 'spaces' })` selects a
 * space-sync archive; the mode is inferred into the instance type, so only a
 * Spaces instance exposes `scope`, `space` and progress in its types.
 */
export class Jetstream<M extends JetstreamMode = 'public'> {
  readonly service: string
  readonly opts: JetstreamOpts<ModeOf<M>>
  readonly mode: ModeOf<M>

  constructor(service: string | JetstreamOpts<M>) {
    const opts: JetstreamOpts<M> =
      typeof service === 'string' ? { service } : service
    const mode = opts.mode ?? 'public'
    if (mode !== 'public' && mode !== 'spaces') {
      throw new TypeError(
        `Jetstream mode must be 'public' or 'spaces' (got ${JSON.stringify(mode)})`,
      )
    }
    // Fail fast on a malformed key: deferring the check to request time
    // either leaks the key into a thrown message or silently disables auth.
    if (opts.apiKey !== undefined) assertValidApiKey(opts.apiKey)
    this.service = opts.service
    // ModeOf<M> is M for either literal, and the check above rejects any
    // other value.
    this.opts = opts as JetstreamOpts<ModeOf<M>>
    this.mode = mode as ModeOf<M>
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

  // Spaces only: one discovery per consumption operation; the returned
  // contract is then reused by every request that operation makes.
  #negotiate(
    kinds: readonly SpacesKind[] | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SpacesProtocol> {
    return negotiateSpacesProtocol({
      host: this.service,
      fetchImpl: this.#resolveFetch(),
      signal,
      kinds,
    })
  }

  live<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: LiveOptsFor<M, F> & { raw?: false } & NoProgress<M>,
  ): AsyncGenerator<TypedFor<M, F>>
  live(
    opts: LiveOptsFor<M> & { raw: true } & NoProgress<M>,
  ): AsyncGenerator<RawFor<M, RawRecordJson>>
  live<const F extends readonly CollectionFilter[] = readonly []>(
    this: Jetstream<'spaces'>,
    opts: SpacesLiveOpts<F> & { raw?: false; progress: true },
  ): AsyncGenerator<TypedSpacesEventFor<F> | JetstreamProgress>
  live(
    this: Jetstream<'spaces'>,
    opts: SpacesLiveOpts & { raw: true; progress: true },
  ): AsyncGenerator<RawSpacesEvent<RawRecordJson> | JetstreamProgress>
  // Implementation signatures are deliberately wide: the overloads are the
  // contract. Every mode's options are a subset of the Spaces shape read
  // here, and shape() (one implementation for every wire) yields only what
  // this instance's mode can produce.
  live(opts: LiveOptsFor<M> | SpacesLiveOpts = {}): AsyncGenerator<unknown> {
    const o = opts as SpacesLiveOpts
    const { schemasByNsid } = parseCollectionFilters(o.collections ?? [])
    return shape(
      this.#liveRawBatches(o),
      { ...o, validateWire: this.opts.validateWire },
      schemasByNsid,
      o.onError,
    )
  }

  snapshot<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: SnapshotOptsFor<M, F> & { raw?: false } & NoProgress<M>,
  ): AsyncGenerator<TypedFor<M, F>>
  snapshot(
    opts: SnapshotOptsFor<M> & { raw: true } & NoProgress<M>,
  ): AsyncGenerator<RawFor<M, RawRecordCbor>>
  snapshot<const F extends readonly CollectionFilter[] = readonly []>(
    this: Jetstream<'spaces'>,
    opts: SpacesSnapshotOpts<F> & { raw?: false; progress: true },
  ): AsyncGenerator<TypedSpacesEventFor<F> | JetstreamProgress>
  snapshot(
    this: Jetstream<'spaces'>,
    opts: SpacesSnapshotOpts & { raw: true; progress: true },
  ): AsyncGenerator<RawSpacesEvent<RawRecordCbor> | JetstreamProgress>
  snapshot(
    opts: SnapshotOptsFor<M> | SpacesSnapshotOpts = {},
  ): AsyncGenerator<unknown> {
    const o = opts as SpacesSnapshotOpts
    const { schemasByNsid } = parseCollectionFilters(o.collections ?? [])
    return shape(
      this.#snapshotRawBatches(o),
      { ...o, validateWire: this.opts.validateWire },
      schemasByNsid,
      o.onError,
    )
  }

  replay<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: ReplayOptsFor<M, F> & { raw?: false } & NoProgress<M>,
  ): AsyncGenerator<TypedFor<M, F>>
  replay(
    opts: ReplayOptsFor<M> & { raw: true } & NoProgress<M>,
  ): AsyncGenerator<RawFor<M>>
  replay<const F extends readonly CollectionFilter[] = readonly []>(
    this: Jetstream<'spaces'>,
    opts: SpacesReplayOpts<F> & { raw?: false; progress: true },
  ): AsyncGenerator<TypedSpacesEventFor<F> | JetstreamProgress>
  replay(
    this: Jetstream<'spaces'>,
    opts: SpacesReplayOpts & { raw: true; progress: true },
  ): AsyncGenerator<RawSpacesEvent | JetstreamProgress>
  replay(
    opts: ReplayOptsFor<M> | SpacesReplayOpts = {},
  ): AsyncGenerator<unknown> {
    const o = opts as SpacesReplayOpts
    const { schemasByNsid } = parseCollectionFilters(o.collections ?? [])
    return shape(
      this.#replayRawBatches(o),
      { ...o, validateWire: this.opts.validateWire },
      schemasByNsid,
      o.onError,
    )
  }

  runner(consumer: ConsumerFor<M>): JetstreamRunner<M> {
    return new JetstreamRunner(this, consumer)
  }

  // The raw batch stream underlying replay(); the runner drives it directly.
  // Snapshot-phase batches carry the CBOR record arm, live-tail batches the
  // JSON arm (discriminate with `record instanceof Uint8Array`).
  replayRawBatches(
    opts: ReplayOptsFor<M>,
  ): AsyncGenerator<BatchFor<M, RawFor<M>>> {
    return this.#replayRawBatches(opts) as AsyncGenerator<
      BatchFor<M, RawFor<M>>
    >
  }

  // The raw batch stream underlying live(); the runner drives it directly.
  // Each event is wrapped in a trivial single-event "batch" with NO extra
  // buffering — live delivery stays realtime. EventBatch is used only as the
  // standard internal interface; snapshot/replay batches carry real grouping.
  liveRawBatches(
    opts: LiveOptsFor<M>,
  ): AsyncGenerator<BatchFor<M, RawFor<M, RawRecordJson>>> {
    return this.#liveRawBatches(opts) as AsyncGenerator<
      BatchFor<M, RawFor<M, RawRecordJson>>
    >
  }

  // The raw batch stream underlying snapshot(); the runner drives it
  // directly. One batch per snapshot block, in strict seq order.
  snapshotRawBatches(
    opts: SnapshotOptsFor<M>,
  ): AsyncGenerator<BatchFor<M, RawFor<M, RawRecordCbor>>> {
    return this.#snapshotRawBatches(opts) as AsyncGenerator<
      BatchFor<M, RawFor<M, RawRecordCbor>>
    >
  }

  // Implementations, typed over the wider Spaces shapes; the public path
  // never produces a Spaces-only value (format 1, no scope, no progress).

  async *#replayRawBatches(
    opts: SpacesReplayOpts,
  ): AsyncGenerator<SpacesEventBatch<RawSpacesEvent>> {
    const { nsids } = parseCollectionFilters(opts.collections ?? [])
    const spaces =
      this.mode === 'spaces'
        ? {
            protocol: await this.#negotiate(opts.kinds, opts.signal),
            progress: opts.progress === true,
          }
        : undefined
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
      onInfo: opts.onInfo,
      maxReplans: opts.maxReplans,
      retry: this.opts.retry,
      validateWire: this.opts.validateWire,
      ...(spaces ? { spaces } : {}),
    })
  }

  #liveRawBatches(
    opts: SpacesLiveOpts,
  ): AsyncGenerator<SpacesEventBatch<RawSpacesEvent<RawRecordJson>>> {
    if (this.mode !== 'spaces') {
      return rawBatchStream(
        this.service,
        { ...opts, headers: this.#authHeaders() },
        2,
        this.opts.validateWire,
      )
    }
    return this.#spacesLiveRawBatches(opts)
  }

  async *#spacesLiveRawBatches(
    opts: SpacesLiveOpts,
  ): AsyncGenerator<SpacesEventBatch<RawSpacesEvent<RawRecordJson>>> {
    const protocol = await this.#negotiate(opts.kinds, opts.signal)
    yield* rawBatchStream(
      this.service,
      { ...opts, headers: this.#authHeaders() },
      2,
      this.opts.validateWire,
      { protocol, progress: opts.progress === true },
    )
  }

  async *#snapshotRawBatches(
    opts: SpacesSnapshotOpts,
  ): AsyncGenerator<SpacesEventBatch<RawSpacesEvent<RawRecordCbor>>> {
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
    // Spaces: one contract for the whole snapshot, re-plans included.
    const protocol =
      this.mode === 'spaces'
        ? await this.#negotiate(opts.kinds, signal)
        : undefined
    // kinds also goes to the planner (below), but the plan is a one-sided
    // transport hint — a selected block can still carry other kinds — so the
    // client-side prune stays authoritative. lastCursor is preserved so the
    // watermark advances past pruned events, and an empty-after-filter batch
    // still yields (same rule as replay's phase).
    const kindsFilter =
      opts.kinds && opts.kinds.length > 0
        ? new Set<string>(opts.kinds)
        : undefined

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
    // Spaces progress: each fully delivered page certifies through its
    // plannedThroughSeq (see cutoverReplay); the floor is already covered.
    const coverage =
      protocol && opts.progress ? new Coverage(resume - 1) : undefined

    for (;;) {
      if (signal?.aborted) return
      try {
        for await (const page of planPages({
          host,
          kinds: opts.kinds,
          dids: opts.dids,
          collections: nsids,
          afterSeq: resume,
          beforeSeq: opts.beforeSeq,
          fetchImpl,
          signal,
          protocol,
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
            protocol,
          })) {
            if (batch.lastCursor > lastEmitted) lastEmitted = batch.lastCursor
            yield kindsFilter
              ? {
                  events: batch.events.filter((e) => kindsFilter.has(e.kind)),
                  lastCursor: batch.lastCursor,
                }
              : batch
          }
          const sealed = {
            kind: 'progress',
            throughSeq: page.plannedThroughSeq,
            caughtUp: false,
          } as const
          if (coverage?.admit(sealed)) {
            yield { events: [], lastCursor: 0, progress: sealed }
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
