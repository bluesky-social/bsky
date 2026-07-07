import { type DidString } from '@atproto/lex-schema'
import { type CollectionFilter } from './engine/collections.js'
import { type EventBatch, type RawEventV1, type SeqEvent } from './event.js'

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
 * The seam element is the v1 raw event (parsed-JSON `record` on put commits);
 * typedEventFromRaw normalizes it into TypedEvent.
 */
export interface JetstreamConsumer {
  collections?: CollectionFilter[]
  dids?: DidString[]
  run(
    stream: AsyncIterable<EventBatch<RawEventV1>>,
    ctx: ConsumerContext,
  ): Promise<void>
}
