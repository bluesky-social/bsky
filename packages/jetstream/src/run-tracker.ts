import { type Ack } from './consumer.js'
import { type EventBatch, type SeqEvent } from './event.js'
import { CommitTracker } from './execute/commit-tracker.js'
import { type CursorStore } from './execute/cursor-store.js'

export interface TrackedStream<E extends SeqEvent> {
  stream: AsyncGenerator<EventBatch<E>>
  ack: Ack
  flush(): Promise<void>
}

/**
 * Wraps a raw-batch source with a CommitTracker. Each pulled event's seq is
 * registered (in ascending pull order) before the batch reaches the consumer;
 * ack(evt) marks that seq done. The tracker advances the saved cursor only to
 * the highest contiguous acked seq and coalesces persistence. ack retains only
 * evt.seq (a number), never the event object.
 */
export function trackedStream<E extends SeqEvent>(
  src: AsyncIterable<EventBatch<E>>,
  store?: CursorStore,
): TrackedStream<E> {
  const tracker = new CommitTracker(store)

  async function* gen(): AsyncGenerator<EventBatch<E>> {
    for await (const batch of src) {
      for (const e of batch.events) tracker.track(e.seq)
      yield batch
    }
  }

  const ack: Ack = (evt) => {
    tracker.done(evt.seq)
  }

  return { stream: gen(), ack, flush: () => tracker.flush() }
}
