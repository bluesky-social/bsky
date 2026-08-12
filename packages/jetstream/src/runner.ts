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
  onInfo?: (info: { name: string; message?: string }) => void
  liveTransport?: LiveTransport
}

/**
 * Drives a JetstreamConsumer from a Jetstream source with cursor tracking:
 * builds the live raw batch stream (filtered by the consumer's static
 * collections/dids/kinds), registers each event's seq with a CommitTracker before
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
      kinds: this.#consumer.kinds,
    })
    await this.#drive(src, opts)
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
