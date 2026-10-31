import { type DidString } from '@atproto/lex'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from '../engine/collections.js'
import {
  type EventBatch,
  type RawEvent,
  type RawEventV1,
  type RawSpacesEvent,
  type SpacesEventBatch,
  type SpacesKind,
} from '../event.js'
import { type CursorStore } from '../execute/cursor-store.js'
import { type RawRecordJson } from '../raw-record.js'
import { type SpacesLiveContract, liveEvents } from './source.js'
import { type LiveTransport, type LiveTransportHeaders } from './transport.js'

export interface LiveStreamOpts {
  collections?: readonly CollectionFilter[]
  dids?: DidString[]
  kinds?: readonly SpacesKind[]
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  onInfo?: (info: { name: string; message?: string }) => void
  liveTransport?: LiveTransport
  /** Handshake headers (e.g. Authorization), set by the owning class. */
  headers?: LiveTransportHeaders
}

/**
 * The raw batch stream both classes build on. Each event becomes a trivial
 * single-event batch with no buffering, so live delivery stays realtime;
 * EventBatch is the internal seam unit that snapshot and replay will fill with
 * real grouping. On a Spaces stream with progress, each coverage message
 * becomes a progress-only batch in its stream position.
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
export function rawBatchStream(
  host: string,
  opts: LiveStreamOpts,
  version: 2,
  validateWire: boolean | undefined,
  spaces: SpacesLiveContract,
): AsyncGenerator<SpacesEventBatch<RawSpacesEvent<RawRecordJson>>>
export async function* rawBatchStream(
  host: string,
  opts: LiveStreamOpts,
  version: 1 | 2,
  validateWire?: boolean,
  spaces?: SpacesLiveContract,
): AsyncGenerator<
  SpacesEventBatch<RawEventV1 | RawSpacesEvent<RawRecordJson>>
> {
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
    headers: opts.headers,
    signal: opts.signal,
    onError: opts.onError,
    onInfo: opts.onInfo,
    validateWire,
  }
  if (spaces) {
    for await (const item of liveEvents({ ...common, version: 2, spaces })) {
      yield item.kind === 'progress'
        ? { events: [], lastCursor: 0, progress: item }
        : { events: [item], lastCursor: item.seq }
    }
    return
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
