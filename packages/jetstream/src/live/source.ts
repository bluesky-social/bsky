import { type DidString } from '@atproto/lex-schema'
import { type RawEventV1 } from '../event.js'
import { decodeLiveFrameV1 } from './decode-v1.js'
import { SKIP_FRAME } from './decode.js'
import { type LiveTransport, wsKeepAliveTransport } from './transport.js'

export { type LiveTransport } from './transport.js'

export interface LiveEventsOpts {
  host: string
  collections?: string[]
  dids?: DidString[]
  cursor?: number // undefined = live from tip; 0 = replay from start
  dedupFloor?: number // undefined = nothing delivered (seq 0 passes); else drop seq <= floor
  transport?: LiveTransport
  signal?: AbortSignal
  onError?: (err: Error) => void
  validateWire?: boolean // strict wire validation: throws MalformedError (fatal), never routed to onError
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

  const te = new TextEncoder()

  for await (const chunk of transport.stream(getUrl, signal)) {
    // NOTE: wsKeepAliveTransport yields strings for websocket text frames even
    // though the type declares Uint8Array. Coerce here so the decoder stays
    // Uint8Array-only.
    const bytes = typeof chunk === 'string' ? te.encode(chunk as string) : chunk
    let ev: RawEventV1 | typeof SKIP_FRAME
    try {
      ev = decodeLiveFrameV1(bytes, opts.validateWire)
    } catch (err) {
      // Strict-mode violations are fatal by contract (the flag asserts the
      // data source) — rethrow past the malformed-frame skip.
      if (opts.validateWire) throw err
      opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      continue // skip malformed / error frames; never fatal in default mode
    }
    if (ev === SKIP_FRAME) continue
    // v1 note: seq is time_us from v1's monotonic clock (strictly increasing,
    // unique — verified in the v1 source), so the inclusive dedup is exact.
    if (lastSeq !== undefined && ev.seq <= lastSeq) continue // dedup inclusive overlap
    lastSeq = ev.seq
    yield ev
  }
}
