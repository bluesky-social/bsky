import { type JetstreamConsumer, type SpacesConsumer } from './consumer.js'
import {
  type EventBatch,
  type JetstreamMode,
  type RawSpacesEvent,
  type SpacesEventBatch,
} from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type ConsumerFor, type Jetstream } from './jetstream.js'
import { type LiveTransport } from './live/transport.js'
import { trackedStream } from './run-tracker.js'

export interface RunnerLiveOpts {
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  onInfo?: (info: { name: string; message?: string }) => void
  liveTransport?: LiveTransport
}

export interface RunnerSnapshotOpts {
  cursor?: CursorStore
  signal?: AbortSignal
  afterSeq?: number
  beforeSeq?: number
  onError?: (err: Error) => void
  maxReplans?: number
}

export interface RunnerReplayOpts {
  cursor?: CursorStore
  signal?: AbortSignal
  afterSeq?: number
  beforeSeq?: number
  onError?: (err: Error) => void
  onInfo?: (info: { name: string; message?: string }) => void
  liveTransport?: LiveTransport
  maxReplans?: number
}

/**
 * Spaces runner options: `progress: true` requests ordered coverage, which
 * the runner saves to the CursorStore once every earlier event is acked —
 * so an empty or fully filtered range still advances the saved cursor, and
 * a failed event holds it back.
 */
export interface RunnerSpacesOpts {
  progress?: boolean
}

type IsSpaces<M extends JetstreamMode> = [M] extends ['spaces'] ? true : false
type RunnerOptsFor<M extends JetstreamMode, O> =
  IsSpaces<M> extends true ? O & RunnerSpacesOpts : O

/**
 * Drives a JetstreamConsumer from a Jetstream source with cursor tracking:
 * builds the mode's raw batch stream (filtered by the consumer's static
 * collections/dids/kinds), registers each event's seq with a CommitTracker
 * before
 * the consumer sees it, and persists the contiguous acked watermark via the
 * CursorStore. flush() runs even when the consumer throws.
 *
 * A Spaces runner drives a SpacesConsumer (`mode: 'spaces'`, e.g.
 * `new LexIndexer({ mode: 'spaces' })`) and checkpoints progress coverage.
 */
export class JetstreamRunner<M extends JetstreamMode = 'public'> {
  readonly #jetstream: Jetstream<M>
  readonly #consumer: ConsumerFor<M>

  constructor(jetstream: Jetstream<M>, consumer: ConsumerFor<M>) {
    // Spaces lifecycle events must be applied in order with the record writes
    // they affect; only a consumer that declares Spaces mode promises that.
    const declared: SpacesConsumer | JetstreamConsumer = consumer
    if (
      jetstream.mode === 'spaces' &&
      !('mode' in declared && declared.mode === 'spaces')
    ) {
      throw new TypeError(
        "a Spaces runner needs a Spaces consumer (mode: 'spaces'), e.g. new LexIndexer({ mode: 'spaces' })",
      )
    }
    this.#jetstream = jetstream
    this.#consumer = consumer
  }

  async live(opts: RunnerOptsFor<M, RunnerLiveOpts> = {}): Promise<void> {
    const src = this.#jetstream.liveRawBatches({
      ...opts,
      collections: this.#consumer.collections,
      dids: this.#consumer.dids,
      kinds: this.#consumer.kinds,
    } as Parameters<Jetstream<M>['liveRawBatches']>[0])
    await this.#drive(src, opts)
  }

  async snapshot(
    opts: RunnerOptsFor<M, RunnerSnapshotOpts> = {},
  ): Promise<void> {
    const src = this.#jetstream.snapshotRawBatches({
      ...opts,
      collections: this.#consumer.collections,
      dids: this.#consumer.dids,
      kinds: this.#consumer.kinds,
    } as Parameters<Jetstream<M>['snapshotRawBatches']>[0])
    await this.#drive(src, opts)
  }

  async replay(opts: RunnerOptsFor<M, RunnerReplayOpts> = {}): Promise<void> {
    const src = this.#jetstream.replayRawBatches({
      ...opts,
      collections: this.#consumer.collections,
      dids: this.#consumer.dids,
      kinds: this.#consumer.kinds,
    } as Parameters<Jetstream<M>['replayRawBatches']>[0])
    await this.#drive(src, opts)
  }

  async #drive(
    src: AsyncIterable<
      EventBatch<RawSpacesEvent> | SpacesEventBatch<RawSpacesEvent>
    >,
    opts: { cursor?: CursorStore; signal?: AbortSignal },
  ): Promise<void> {
    const ts = trackedStream(src, opts.cursor)
    // Both consumer contracts take the same stream shape at runtime (a public
    // stream simply never carries a Spaces-only value), so calling through
    // the wider Spaces signature is sound for either.
    const consumer = this.#consumer as SpacesConsumer
    try {
      // Forward the caller's signal (if any) to the seam ctx. The seam's signal
      // is optional; LexIndexer synthesizes its own guaranteed handler signal.
      await consumer.run(ts.stream, { ack: ts.ack, signal: opts.signal })
    } finally {
      await ts.flush()
    }
  }
}
