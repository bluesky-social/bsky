import { defaultRuntime } from '#runtime'
import {
  CloseCode,
  CloseError,
  SocketError,
  type WebSocketOptions,
  defaultShouldReconnect,
  websocket,
} from '@atproto/ws-client'
import { ProtocolError } from '../errors.js'

// The WHATWG HeadersInit shape, spelled out because the ambient name isn't
// in scope under this project's lib set. Narrower than undici's in one
// deliberate way: values are `string`, not `string | undefined` — so
// `{ authorization: undefined }` is a type error rather than a header that
// normalizes to the wire as "undefined".
export type LiveTransportHeaders =
  Record<string, string> | [string, string][] | Headers

export interface LiveTransportOpts {
  /**
   * Headers for the connection handshake (e.g. Authorization). Captured once
   * per stream() call — not re-read on internal reconnects, which is fine
   * for a static credential like an API key.
   */
  headers?: LiveTransportHeaders
  /**
   * Spaces mode only. When set, the transport must call it with the upgrade
   * response headers of EVERY accepted connection (including reconnects)
   * before yielding that connection's first frame, and end the stream with
   * the error if it throws. Spaces mode verifies the negotiated protocol
   * (and progress acknowledgement) this way; a transport that cannot observe
   * upgrade responses must throw rather than ignore it, and a stream that
   * yields a frame without ever reporting headers is rejected.
   */
  onUpgrade?: (headers: Headers) => void
}

export interface LiveTransport {
  // Yields raw frames (bytes or text). getUrl() is called once per
  // (re)connection so the resume cursor reflects the highest-delivered seq at
  // connect time. The returned iterable should reconnect internally and end
  // only on signal abort or a non-reconnectable error.
  stream(
    getUrl: () => string,
    signal: AbortSignal,
    opts?: LiveTransportOpts,
  ): AsyncIterable<Uint8Array | string>
}

// Jetstream frames are JSON text: dataMode 'text' types the stream as string
// and makes a binary frame a fatal DataModeError (crash over silent
// misinterpretation). The decoder still accepts Uint8Array | string for
// custom transports.
export type WebsocketTransportOptions = Omit<
  WebSocketOptions<'text'>,
  'signal' | 'dataMode' | 'idleTimeoutMs'
> & {
  /**
   * End (and redial) the connection when no message arrives within this
   * window. Default 60_000: jetstream is a firehose that normally never goes
   * quiet, and in the browser this is the only dead-connection detector.
   * `false` disables idle detection. Must be > 0 when a number: ws-client
   * runs the idle timer on a plain `setInterval`, so 0 (or negative) would
   * silently clamp to a ~1ms timer and redial in a tight loop; use `false`
   * to disable idle detection instead.
   */
  idleTimeoutMs?: number | false
}

// ws raises `Unexpected server response: <status>` when an upgrade is refused
// and discards the response body, so the XRPC error envelope naming
// CursorTooOld is unreachable from here — only the status is available.
// Matching on someone else's message text is a stopgap until ws-client
// surfaces the handshake response; the unit tests fail loudly if it changes.
const HANDSHAKE_REJECTION_RE = /Unexpected server response: (\d{3})/

export function handshakeRejectionStatus(error: unknown): number | undefined {
  // ws-client wraps the raw ws error in a SocketError, one level deep.
  if (!(error instanceof SocketError)) return undefined
  const cause = error.cause
  if (!(cause instanceof Error)) return undefined
  const match = HANDSHAKE_REJECTION_RE.exec(cause.message)
  return match ? Number(match[1]) : undefined
}

// A jetstream server closing 1000 (restart, load-shed) should not end the
// consumer's stream — the resume cursor makes the redial seamless. Everything
// else keeps ws-client's classification: protocol closes
// (1002/1003/1007/1009), DataModeError, and local resource errors stay fatal.
export function jetstreamShouldReconnect(error: unknown): boolean {
  // A 4xx refusal is permanent for this request; 5xx is transient and keeps
  // the default treatment.
  const status = handshakeRejectionStatus(error)
  if (status !== undefined) {
    if (status >= 400 && status < 500) return false
    if (status >= 500) return true
  }
  return (
    (error instanceof CloseError && error.code === CloseCode.Normal) ||
    defaultShouldReconnect(error)
  )
}

// Jetstream's defaults over the caller's options. Kept pure (no socket) so
// the defaults are unit-testable; websocketTransport() adds only the
// per-stream wiring (url, signal).
export function resolveWebsocketOptions(
  options: WebsocketTransportOptions = {},
): WebSocketOptions<'text'> & { dataMode: 'text' } {
  const {
    idleTimeoutMs = 60_000,
    shouldReconnect = jetstreamShouldReconnect,
    ...rest
  } = options
  if (Number.isNaN(idleTimeoutMs)) {
    throw new RangeError(
      'idleTimeoutMs must be > 0; use false to disable idle detection',
    )
  }
  if (idleTimeoutMs !== false && idleTimeoutMs <= 0) {
    throw new RangeError(
      'idleTimeoutMs must be > 0; use false to disable idle detection',
    )
  }
  return {
    ...rest,
    shouldReconnect,
    idleTimeoutMs: idleTimeoutMs === false ? undefined : idleTimeoutMs,
    dataMode: 'text',
  }
}

// Per-stream headers (apiKey auth) merge over the factory's own
// options.headers: same-name entries from the stream win. undefined in,
// undefined out — the browser transport throws on ANY headers (upgrade
// headers are Node-only), so an empty Headers must not appear when neither
// side set one.
function mergeHeaders(
  base: WebSocketOptions<'text'>['headers'],
  extra: LiveTransportHeaders | undefined,
): WebSocketOptions<'text'>['headers'] {
  if (!extra) return base
  if (!base) return extra
  const merged = new Headers(base)
  for (const [name, value] of new Headers(extra)) merged.set(name, value)
  return merged
}

export function websocketTransport(
  options?: WebsocketTransportOptions,
): LiveTransport {
  const resolved = resolveWebsocketOptions(options)
  return {
    stream(getUrl, signal, opts) {
      const headers = mergeHeaders(resolved.headers, opts?.headers)
      if (opts?.onUpgrade) {
        return verifiedStream(resolved, getUrl, signal, headers, opts.onUpgrade)
      }
      // getUrl is passed straight through: websocket() re-resolves a function
      // url on every (re)connection, which is exactly the resume-cursor
      // contract stream() requires.
      return websocket(getUrl, { ...resolved, signal, headers })
    },
  }
}

// The same websocket stream, with each connection's upgrade response handed
// to onUpgrade before any of its frames is yielded. The response is captured
// by the runtime's upgrade observer (the websocket client does not expose
// it) and checked when the connection opens; a failed check aborts the
// stream with that error.
async function* verifiedStream(
  resolved: WebSocketOptions<'text'> & { dataMode: 'text' },
  getUrl: () => string,
  signal: AbortSignal,
  headers: WebSocketOptions<'text'>['headers'],
  onUpgrade: (headers: Headers) => void,
): AsyncGenerator<string> {
  const observer = defaultRuntime.upgradeObserver()
  if (!observer) {
    throw new ProtocolError(
      'jetstream: this platform cannot observe WebSocket upgrade response headers, which Spaces mode must verify; supply a liveTransport that reports them (LiveTransportOpts.onUpgrade)',
    )
  }
  const inner = new AbortController()
  const forwardAbort = () => inner.abort(signal.reason)
  if (signal.aborted) forwardAbort()
  else signal.addEventListener('abort', forwardAbort, { once: true })
  let observed: Headers | undefined
  let failure: unknown
  const iterator = websocket(getUrl, {
    ...resolved,
    signal: inner.signal,
    headers,
    onConnect(sender) {
      resolved.onConnect?.(sender)
      const upgrade = observed
      observed = undefined
      try {
        if (!upgrade) {
          throw new ProtocolError(
            'jetstream: WebSocket upgrade response headers were not observed',
          )
        }
        onUpgrade(upgrade)
      } catch (err) {
        failure ??= err
        inner.abort(err)
      }
    },
  })[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await observer.observe(
        (h) => {
          observed = h
        },
        () => iterator.next(),
      )
      if (failure !== undefined) throw failure
      if (next.done) return
      yield next.value
    }
  } catch (err) {
    throw failure ?? err
  } finally {
    signal.removeEventListener('abort', forwardAbort)
    await iterator.return(undefined)
  }
}
