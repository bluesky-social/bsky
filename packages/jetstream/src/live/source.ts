import { type EventBatch, type RawEventV1, type SeqEvent } from '../event.js'
import { decodeLiveFrameV1 } from './decode-v1.js'
import { SKIP_FRAME } from './decode.js'
import { type LiveTransport, wsKeepAliveTransport } from './transport.js'

export { type LiveTransport } from './transport.js'

export interface LiveEventsOpts {
  host: string
  collections?: string[]
  dids?: string[]
  cursor?: number // undefined = live from tip; 0 = replay from start
  dedupFloor?: number // undefined = nothing delivered (seq 0 passes); else drop seq <= floor
  transport?: LiveTransport
  signal?: AbortSignal
  onError?: (err: Error) => void
}

function wsScheme(host: string): string {
  const u = new URL(host)
  if (u.protocol === 'http:') u.protocol = 'ws:'
  else if (u.protocol === 'https:') u.protocol = 'wss:'
  return u.origin
}

export async function* liveEvents(
  opts: LiveEventsOpts,
): AsyncGenerator<RawEventV1> {
  const origin = wsScheme(opts.host)
  const transport = opts.transport ?? wsKeepAliveTransport
  const signal = opts.signal ?? new AbortController().signal
  // lastSeq is the highest DELIVERED seq = reconnect cursor + dedup floor.
  // undefined means nothing delivered yet (seq 0 passes).
  let lastSeq: number | undefined = opts.dedupFloor

  const getUrl = (): string => {
    const u = new URL('/subscribe', origin)
    // Resume from highest-delivered once anything has been delivered; otherwise
    // fall back to the initial wire cursor (which may be 0 = replay from start).
    const wire = lastSeq ?? opts.cursor
    if (wire !== undefined) u.searchParams.set('cursor', String(wire))
    for (const c of opts.collections ?? [])
      u.searchParams.append('wantedCollections', c)
    for (const d of opts.dids ?? []) u.searchParams.append('wantedDids', d)
    return u.toString()
  }

  for await (const chunk of transport.stream(getUrl, signal)) {
    let ev: RawEventV1 | typeof SKIP_FRAME
    try {
      ev = decodeLiveFrameV1(chunk)
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      continue // skip malformed / error frames; never fatal
    }
    if (ev === SKIP_FRAME) continue
    // v1 note: seq is time_us from v1's monotonic clock (strictly increasing,
    // unique — verified in the v1 source), so the inclusive dedup is exact.
    if (lastSeq !== undefined && ev.seq <= lastSeq) continue // dedup inclusive overlap
    lastSeq = ev.seq
    yield ev
  }
}

export async function* batchEvents<E extends SeqEvent>(
  src: AsyncGenerator<E>,
  batchSize: number,
): AsyncGenerator<EventBatch<E>> {
  let events: E[] = []
  let lastCursor = 0
  for await (const ev of src) {
    events.push(ev)
    if (ev.seq > lastCursor) lastCursor = ev.seq
    if (events.length >= batchSize) {
      yield { events, lastCursor }
      events = []
    }
  }
  if (events.length > 0) yield { events, lastCursor }
}
