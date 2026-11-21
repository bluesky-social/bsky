import { type DidString } from '@atproto/lex'
import { type CollectionFilter } from './engine/collections.js'
import {
  type EventBatch,
  type Kind,
  type RawEvent,
  type RawSpacesEvent,
  type SeqEvent,
  type SpacesEventBatch,
  type SpacesKind,
} from './event.js'

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
 * Source-agnostic event processor. `collections`/`dids`/`kinds` are static
 * declarations of what the consumer handles; a Jetstream source reads them to
 * build the server-side filter. The consumer drives its own loop over the
 * raw-batch stream, decides its own concurrency/ordering, and calls ack(evt)
 * on completion. It knows nothing about cursors.
 *
 * The seam element is the v2 `RawEvent`: put commits carry the record in its
 * wire representation, and the stream may include sync events.
 * typedEventFromRaw normalizes an event into TypedEvent. This seam is v2-only
 * — `time` and the `sync` arm are honestly present.
 */
export interface JetstreamConsumer {
  collections?: CollectionFilter[]
  dids?: DidString[]
  kinds?: Kind[]
  run(
    stream: AsyncIterable<EventBatch<RawEvent>>,
    ctx: ConsumerContext,
  ): Promise<void>
}

/**
 * The consumer contract for a Spaces runner (`new Jetstream({ mode:
 * 'spaces' })`). The stream carries Spaces events — `space` on commits and
 * syncs, scope markers — and, with progress, progress-only batches whose
 * coverage the runner checkpoints once every earlier event is acked.
 *
 * `mode: 'spaces'` is the consumer's declaration that it applies lifecycle
 * events (scope, scoped sync, account) in order with respect to record
 * writes; a repository reset or space deletion affects many records, so a
 * per-record concurrency key alone cannot order it. LexIndexer in Spaces
 * mode does this by running handlers serially.
 */
export interface SpacesConsumer {
  readonly mode: 'spaces'
  collections?: CollectionFilter[]
  dids?: DidString[]
  kinds?: SpacesKind[]
  run(
    stream: AsyncIterable<SpacesEventBatch<RawSpacesEvent>>,
    ctx: ConsumerContext,
  ): Promise<void>
}
