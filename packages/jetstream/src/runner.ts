import { type JetstreamConsumer } from './consumer.js'
import { type EventBatch, type RawEvent } from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type Jetstream } from './jetstream.js'
import { type LiveTransport } from './live/transport.js'
import { trackedStream } from './run-tracker.js'

export interface RunnerLiveOpts {
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
}

/**
 * Drives a JetstreamConsumer from a Jetstream source with cursor tracking:
 * builds the live raw batch stream (filtered by the consumer's static
 * collections/dids), registers each event's seq with a CommitTracker before
 * the consumer sees it, and persists the contiguous acked watermark via the
 * CursorStore. flush() runs even when the consumer throws.
 */
export class JetstreamRunner {
  readonly #jetstream: Jetstream
  readonly #consumer: JetstreamConsumer

  constructor(jetstream: Jetstream, consumer: JetstreamConsumer) {
    this.#jetstream = jetstream
    this.#consumer = consumer
  }

  async live(opts: RunnerLiveOpts = {}): Promise<void> {
    const src = this.#jetstream.liveRawBatches({
      ...opts,
      collections: this.#consumer.collections,
      dids: this.#consumer.dids,
    })
    // TEMPORARY: Jetstream is still v1-backed (liveRawBatches yields
    // EventBatch<RawEventV1>), but the runner/consumer seam is v2-only
    // (EventBatch<RawEvent>) — see event.ts for why the two are not
    // assignable. Task 10 flips Jetstream to speak v2, at which point this
    // cast is removed and the assignment becomes honestly type-safe. Nothing
    // downstream of this cast reads the v2-only `time` field today (only
    // `seq`), so this is not a runtime hazard in the interim. Deliberately a
    // single `as` (not `as unknown as`): AsyncGenerator's type argument stays
    // comparable even though RawEventV1/RawEvent are not assignable, so a
    // future divergence (e.g. RawRecord gaining a CBOR arm, or an envelope
    // rename) still re-errors here instead of silently passing.
    await this.#drive(src as AsyncGenerator<EventBatch<RawEvent>>, opts)
  }

  async #drive(
    src: AsyncGenerator<EventBatch<RawEvent>>,
    opts: { cursor?: CursorStore; signal?: AbortSignal },
  ): Promise<void> {
    const ts = trackedStream(src, opts.cursor)
    try {
      // Forward the caller's signal (if any) to the seam ctx. The seam's signal
      // is optional; LexIndexer synthesizes its own guaranteed handler signal.
      await this.#consumer.run(ts.stream, { ack: ts.ack, signal: opts.signal })
    } finally {
      await ts.flush()
    }
  }
}
