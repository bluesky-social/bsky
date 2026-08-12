import { type DidString } from '@atproto/lex'
import { type Kind, type RawEvent, type RawEventV1 } from '../event.js'
import { type RawRecordJson } from '../raw-record.js'
import { decodeLiveFrameV1 } from './decode-v1.js'
import { type LiveInfoFrame, SKIP_FRAME, decodeLiveFrame } from './decode.js'
import { type LiveTransport, websocketTransport } from './transport.js'

export { type LiveTransport } from './transport.js'

const V2_NSID = 'network.bsky.jetstream.subscribeEvents'

// v2's ?cursor= has two domains split at this threshold (server
// internal/subscribe/cursor.go): below it a cursor is a seq, at or above it the
// server reads a unix-µs timestamp and translates it. A timestamp value must
// never seed the dedup floor — it is not a seq, so every real seq would compare
// as a duplicate. v1 has no split: there, seq IS time_us.
const V2_CURSOR_SEQ_MAX_THRESHOLD = 1e15

// Server-side caps on the v2 filter params. Exceeding one is a pre-upgrade 400
// whose body `ws` discards, so check locally and say why.
const V2_MAX_DIDS = 10_000
const V2_MAX_COLLECTIONS = 100

export interface LiveEventsOpts {
  host: string
  collections?: string[]
  dids?: DidString[]
  /**
   * Event kinds to receive (v2 only). Omitted means all kinds. The collections
   * filter constrains only commits, so a commits-only stream needs
   * kinds: ['commit'].
   */
  kinds?: Kind[]
  cursor?: number // undefined = live from tip; 0 = replay from start
  dedupFloor?: number // undefined = nothing delivered (seq 0 passes); else drop seq <= floor
  transport?: LiveTransport
  signal?: AbortSignal
  onError?: (err: Error) => void
  version?: 1 | 2 // default 2; 1 uses the frozen /subscribe wire + v1 decoder
  validateWire?: boolean // strict wire validation: throws MalformedError (fatal), never routed to onError
}

function wsScheme(host: string): string {
  const u = new URL(host)
  if (u.protocol === 'http:') u.protocol = 'ws:'
  else if (u.protocol === 'https:') u.protocol = 'wss:'
  return u.origin
}

// The two wires yield different envelopes, so the overloads pick per version
// and the implementation is honest about producing either.
export function liveEvents(
  opts: LiveEventsOpts & { version: 1 },
): AsyncGenerator<RawEventV1>
export function liveEvents(
  opts: LiveEventsOpts,
): AsyncGenerator<RawEvent<RawRecordJson>>
export async function* liveEvents(
  opts: LiveEventsOpts,
): AsyncGenerator<RawEventV1 | RawEvent<RawRecordJson>> {
  const version = opts.version ?? 2
  // v1 has no kinds equivalent. Ignoring the filter would deliver kinds the
  // caller asked to exclude, which is worse than failing.
  if (version === 1 && opts.kinds?.length) {
    throw new Error(
      'jetstream v1 does not support the kinds filter (v1 /subscribe has no equivalent parameter)',
    )
  }
  if (version === 2) {
    if ((opts.dids?.length ?? 0) > V2_MAX_DIDS) {
      throw new RangeError(
        `dids filter exceeds the server limit of ${V2_MAX_DIDS}`,
      )
    }
    if ((opts.collections?.length ?? 0) > V2_MAX_COLLECTIONS) {
      throw new RangeError(
        `collections filter exceeds the server limit of ${V2_MAX_COLLECTIONS}`,
      )
    }
  }
  // The decoder-select union is the truth: the v1 decoder yields RawEventV1 (a
  // subtype), the v2 decoder yields RawEvent plus LiveInfoFrame, and both can
  // yield SKIP_FRAME.
  const decode: (
    chunk: Uint8Array | string,
    validateWire?: boolean,
  ) =>
    RawEventV1 | RawEvent<RawRecordJson> | LiveInfoFrame | typeof SKIP_FRAME =
    version === 1 ? decodeLiveFrameV1 : decodeLiveFrame

  const origin = wsScheme(opts.host)
  const transport = opts.transport ?? websocketTransport()
  const signal = opts.signal ?? new AbortController().signal
  // lastSeq is the highest DELIVERED seq = reconnect cursor + dedup floor.
  // undefined means nothing delivered yet (seq 0 passes). A v2 timestamp
  // cursor stays wire-only: leave lastSeq unset so the first delivered event
  // establishes a real floor, while getUrl keeps sending the timestamp.
  const isTimestampDomainFloor =
    version === 2 &&
    opts.dedupFloor !== undefined &&
    opts.dedupFloor >= V2_CURSOR_SEQ_MAX_THRESHOLD
  let lastSeq: number | undefined = isTimestampDomainFloor
    ? undefined
    : opts.dedupFloor

  const getUrl = (): string => {
    const u = new URL(version === 1 ? '/subscribe' : `/xrpc/${V2_NSID}`, origin)
    // Resume from highest-delivered once anything has been delivered; otherwise
    // fall back to the initial wire cursor (which may be 0 = replay from start).
    const wire = lastSeq ?? opts.cursor
    if (wire !== undefined) u.searchParams.set('cursor', String(wire))
    // The param names are version-gated and must not cross: v2 answers the v1
    // names with a 400 rather than ignoring them.
    if (version === 1) {
      for (const c of opts.collections ?? [])
        u.searchParams.append('wantedCollections', c)
      for (const d of opts.dids ?? []) u.searchParams.append('wantedDids', d)
    } else {
      for (const c of opts.collections ?? [])
        u.searchParams.append('collections', c)
      for (const d of opts.dids ?? []) u.searchParams.append('dids', d)
      for (const k of opts.kinds ?? []) u.searchParams.append('kinds', k)
    }
    return u.toString()
  }

  for await (const chunk of transport.stream(getUrl, signal)) {
    let ev:
      RawEventV1 | RawEvent<RawRecordJson> | LiveInfoFrame | typeof SKIP_FRAME
    try {
      ev = decode(chunk, opts.validateWire)
    } catch (err) {
      // Strict-mode violations are fatal by contract (the flag asserts the
      // data source) — rethrow past the malformed-frame skip.
      if (opts.validateWire) throw err
      opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      continue // skip malformed / error frames; never fatal in default mode
    }
    if (ev === SKIP_FRAME) continue
    if ('info' in ev) {
      // Seq-less advisory: reported, never fatal, and it does not move the
      // cursor.
      opts.onError?.(
        new Error(`jetstream info: ${ev.info.name}: ${ev.info.message ?? ''}`),
      )
      continue
    }
    // v1 note: seq is time_us from v1's monotonic clock (strictly increasing,
    // unique), so the inclusive dedup is exact for both versions.
    if (lastSeq !== undefined && ev.seq <= lastSeq) continue
    lastSeq = ev.seq
    yield ev
  }
}
