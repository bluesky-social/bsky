import { type DidString } from '@atproto/lex'
import { ProtocolError } from '../errors.js'
import {
  type JetstreamProgress,
  type RawEvent,
  type RawEventV1,
  type RawSpacesEvent,
  type SpacesKind,
} from '../event.js'
import { assertWireFilters } from '../filter-limits.js'
import { type RawRecordJson } from '../raw-record.js'
import {
  PROGRESS_HEADER,
  type SpacesProtocol,
  assertNegotiatedHeaders,
} from '../xrpc/protocol.js'
import { decodeLiveFrameV1 } from './decode-v1.js'
import {
  type LiveInfoFrame,
  type LiveProgressFrame,
  SKIP_FRAME,
  decodeLiveFrame,
} from './decode.js'
import {
  type LiveTransport,
  type LiveTransportHeaders,
  type LiveTransportOpts,
  websocketTransport,
} from './transport.js'

export { type LiveTransport } from './transport.js'

const V2_NSID = 'network.bsky.jetstream.subscribeEvents'

// v2's ?cursor= has two domains split at this threshold (server
// internal/subscribe/cursor.go): below it a cursor is a seq, at or above it the
// server reads a unix-µs timestamp and translates it. A timestamp value must
// never seed the dedup floor — it is not a seq, so every real seq would compare
// as a duplicate. v1 has no split: there, seq IS time_us.
const V2_CURSOR_SEQ_MAX_THRESHOLD = 1e15

/**
 * Certified coverage for one consumption operation, shared by all of its
 * phases (sealed sweep, live tail, every reconnect). Coverage only moves
 * forward; repeating a position is admitted only to add caughtUp. Once any
 * data was skipped (`blocked`), nothing more is certified: later progress
 * would claim the skipped data.
 */
export class Coverage {
  blocked = false
  #through: number
  #caughtUp = false

  /** `floor`: the highest position already covered before this operation. */
  constructor(floor: number) {
    this.#through = floor
  }

  admit(p: JetstreamProgress): boolean {
    if (this.blocked) return false
    if (
      p.throughSeq > this.#through ||
      (p.throughSeq === this.#through && p.caughtUp && !this.#caughtUp)
    ) {
      this.#through = p.throughSeq
      this.#caughtUp = p.caughtUp
      return true
    }
    return false
  }
}

/** The Spaces contract for one live subscription. */
export interface SpacesLiveContract {
  /** Selected once per consumption operation and reused on every reconnect. */
  protocol: SpacesProtocol
  /** Request ordered #progress coverage (progress=true). */
  progress?: boolean
  /** The operation's shared coverage; a fresh one per subscription if omitted. */
  coverage?: Coverage
}

export interface LiveEventsOpts {
  host: string
  collections?: string[]
  dids?: DidString[]
  /**
   * Event kinds to receive (v2 only). Omitted means all kinds. The collections
   * filter constrains only commits, so a commits-only stream needs
   * kinds: ['commit']. `scope` is accepted only with `spaces`.
   */
  kinds?: readonly SpacesKind[]
  cursor?: number // undefined = live from tip; 0 = replay from start
  dedupFloor?: number // undefined = nothing delivered (seq 0 passes); else drop seq <= floor
  transport?: LiveTransport
  headers?: LiveTransportHeaders // connection handshake headers (e.g. Authorization)
  signal?: AbortSignal
  onError?: (err: Error) => void
  /**
   * Seq-less server advisories (`#info` frames, e.g. `OutdatedCursor`). v2
   * only — the v1 wire has no `#info` frame. Not an error: when omitted, an
   * advisory is dropped silently rather than routed to onError.
   */
  onInfo?: (info: { name: string; message?: string }) => void
  version?: 1 | 2 // default 2; 1 uses the frozen /subscribe wire + v1 decoder
  validateWire?: boolean // strict wire validation: throws MalformedError (fatal), never routed to onError
  /** Spaces mode (v2 endpoint only); absent is the unchanged public wire. */
  spaces?: SpacesLiveContract
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
  opts: LiveEventsOpts & { spaces: SpacesLiveContract },
): AsyncGenerator<RawSpacesEvent<RawRecordJson> | JetstreamProgress>
export function liveEvents(
  opts: LiveEventsOpts,
): AsyncGenerator<RawEvent<RawRecordJson>>
export async function* liveEvents(
  opts: LiveEventsOpts,
): AsyncGenerator<
  RawEventV1 | RawSpacesEvent<RawRecordJson> | JetstreamProgress
> {
  const version = opts.version ?? 2
  const spaces = opts.spaces
  if (spaces && version !== 2) {
    throw new Error('jetstream: Spaces mode requires the v2 endpoint')
  }
  // v1 has no kinds equivalent. Ignoring the filter would deliver kinds the
  // caller asked to exclude, which is worse than failing.
  if (version === 1 && opts.kinds?.length) {
    throw new Error(
      'jetstream v1 does not support the kinds filter (v1 /subscribe has no equivalent parameter)',
    )
  }
  // v2 only: v1's wanted* params have their own (looser) server contract.
  if (version === 2) assertWireFilters(opts, spaces !== undefined)
  // The decoder-select union is the truth: the v1 decoder yields RawEventV1 (a
  // subtype), the v2 decoder yields RawEvent plus LiveInfoFrame (and, on a
  // Spaces stream, Spaces events and progress), and all can yield SKIP_FRAME.
  const decodeOpts = spaces
    ? { spaces: true, progress: spaces.progress === true }
    : undefined
  const decode = (
    chunk: Uint8Array | string,
  ):
    | RawEventV1
    | RawSpacesEvent<RawRecordJson>
    | LiveInfoFrame
    | LiveProgressFrame
    | typeof SKIP_FRAME =>
    version === 1
      ? decodeLiveFrameV1(chunk, opts.validateWire)
      : decodeOpts
        ? decodeLiveFrame(chunk, opts.validateWire, decodeOpts)
        : decodeLiveFrame(chunk, opts.validateWire)
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
    if (spaces) {
      u.searchParams.set(
        'protocolVersion',
        String(spaces.protocol.protocolVersion),
      )
      if (spaces.progress) u.searchParams.set('progress', 'true')
    }
    return u.toString()
  }

  // Spaces: every accepted connection must echo the selected protocol (and
  // acknowledge progress when requested) — checked by the transport per
  // connection; a transport that never reports a handshake is rejected at
  // its first frame rather than trusted.
  let upgradeVerified = false
  const onUpgrade = spaces
    ? (headers: Headers): void => {
        assertNegotiatedHeaders(headers, spaces.protocol, 'subscribeEvents')
        if (spaces.progress && headers.get(PROGRESS_HEADER) !== 'true') {
          throw new ProtocolError(
            'jetstream: subscribeEvents: progress requested but the upgrade did not acknowledge it (Jetstream-Progress)',
          )
        }
        upgradeVerified = true
      }
    : undefined
  const transportOpts: LiveTransportOpts | undefined =
    opts.headers || onUpgrade
      ? {
          ...(opts.headers ? { headers: opts.headers } : {}),
          ...(onUpgrade ? { onUpgrade } : {}),
        }
      : undefined

  // Coverage certification (Spaces progress only): see Coverage. Without a
  // shared one, the resume floor counts as already covered.
  const coverage = spaces?.coverage ?? new Coverage(lastSeq ?? -1)
  for await (const chunk of transport.stream(getUrl, signal, transportOpts)) {
    if (onUpgrade && !upgradeVerified) {
      throw new ProtocolError(
        'jetstream: the live transport did not report the WebSocket upgrade headers Spaces mode must verify (LiveTransportOpts.onUpgrade)',
      )
    }
    let ev:
      | RawEventV1
      | RawSpacesEvent<RawRecordJson>
      | LiveInfoFrame
      | LiveProgressFrame
      | typeof SKIP_FRAME
    try {
      ev = decode(chunk)
    } catch (err) {
      // Strict-mode violations are fatal by contract (the flag asserts the
      // data source) — rethrow past the malformed-frame skip.
      if (opts.validateWire) throw err
      coverage.blocked = true
      opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      continue // skip malformed / error frames; never fatal in default mode
    }
    if (ev === SKIP_FRAME) {
      coverage.blocked = true
      continue
    }
    if ('info' in ev) {
      // Seq-less advisory: never fatal, and it does not move the cursor. Not
      // an error, so drop it silently when no onInfo is registered.
      opts.onInfo?.(ev.info)
      continue
    }
    if ('progress' in ev) {
      if (coverage.admit(ev.progress)) yield ev.progress
      continue
    }
    // v1 note: seq is time_us from v1's monotonic clock (strictly increasing,
    // unique), so the inclusive dedup is exact for both versions.
    if (lastSeq !== undefined && ev.seq <= lastSeq) continue
    lastSeq = ev.seq
    yield ev
  }
}
