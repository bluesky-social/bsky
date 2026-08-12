import { type DidString } from '@atproto/lex'
import { type CollectionFilter } from './engine/collections.js'
import { type EventBatch, type RawEvent, type SeqEvent } from './event.js'

/**
 * Signals that the consumer has finished processing an event. Fire-and-forget:
 * the source records evt.seq synchronously and never retains the event object.
 * Not calling ack for an event holds the resume watermark below its seq. Only
 * reads the cursor, so it accepts any SeqEvent.
 */
export type Ack = (evt: SeqEvent) => void

/**
 * Context handed to a consumer's run(): the ack callback plus an optional
 * AbortSignal. `signal`, when present, is the caller's cancellation signal
 * (the runner forwards run()'s signal here). It is optional at the seam — a
 * non-Jetstream source need not provide one. (LexIndexer guarantees its OWN
 * handler-facing signal regardless; see HandlerContext.)
 */
export interface ConsumerContext {
  ack: Ack
  signal?: AbortSignal
}

/**
 * Source-agnostic event processor. `collections`/`dids` are static declarations
 * of what the consumer handles; a Jetstream source reads them to build the
 * server-side filter. The consumer drives its own loop over the raw-batch
 * stream, decides its own concurrency/ordering, and calls ack(evt) on
 * completion. It knows nothing about cursors.
 *
 * The seam element is the v2 `RawEvent`: put commits carry the record in its
 * wire representation, and the stream may include sync events.
 * typedEventFromRaw normalizes an event into TypedEvent. By design, this
 * seam should only ever see v2 events — but as of this commit, JetstreamRunner
 * casts the (still v1-backed) Jetstream's raw batches into it (see
 * runner.ts), so a real event here may in fact be a RawEventV1 wearing this
 * type; do not assume `time`/`sync` are honestly present until that cast is
 * removed (Task 10 flips Jetstream to v2).
 */
export interface JetstreamConsumer {
  collections?: CollectionFilter[]
  dids?: DidString[]
  run(
    stream: AsyncIterable<EventBatch<RawEvent>>,
    ctx: ConsumerContext,
  ): Promise<void>
}
