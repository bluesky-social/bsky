import { type DidString } from '@atproto/lex'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from '../engine/collections.js'
import {
  type EventBatch,
  type Kind,
  type RawEvent,
  type RawEventV1,
} from '../event.js'
import { type CursorStore } from '../execute/cursor-store.js'
import { type RawRecordJson } from '../raw-record.js'
import { liveEvents } from './source.js'
import { type LiveTransport } from './transport.js'

export interface LiveStreamOpts {
  collections?: readonly CollectionFilter[]
  dids?: DidString[]
  kinds?: Kind[]
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  onInfo?: (info: { name: string; message?: string }) => void
  liveTransport?: LiveTransport
}

/**
 * The raw batch stream both classes build on. Each event becomes a trivial
 * single-event batch with no buffering, so live delivery stays realtime;
 * EventBatch is the internal seam unit that snapshot and replay will fill with
 * real grouping.
 */
export function rawBatchStream(
  host: string,
  opts: LiveStreamOpts,
  version: 1,
  validateWire?: boolean,
): AsyncGenerator<EventBatch<RawEventV1>>
export function rawBatchStream(
  host: string,
  opts: LiveStreamOpts,
  version: 2,
  validateWire?: boolean,
): AsyncGenerator<EventBatch<RawEvent<RawRecordJson>>>
export async function* rawBatchStream(
  host: string,
  opts: LiveStreamOpts,
  version: 1 | 2,
  validateWire?: boolean,
): AsyncGenerator<EventBatch<RawEventV1 | RawEvent<RawRecordJson>>> {
  const { nsids } = parseCollectionFilters(opts.collections ?? [])
  const start = await opts.cursor?.load()
  const common = {
    host,
    collections: nsids,
    dids: opts.dids,
    kinds: opts.kinds,
    cursor: start,
    dedupFloor: start, // a resume cursor is also the dedup floor
    transport: opts.liveTransport,
    signal: opts.signal,
    onError: opts.onError,
    onInfo: opts.onInfo,
    validateWire,
  }
  // Branch on a literal version so each call selects the right liveEvents
  // overload — the envelopes differ, so a non-literal `version` would type the
  // v1 stream as v2.
  const events =
    version === 1
      ? liveEvents({ ...common, version: 1 })
      : liveEvents({ ...common, version: 2 })
  for await (const ev of events) {
    yield { events: [ev], lastCursor: ev.seq }
  }
}
