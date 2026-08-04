import {
  CloseCode,
  CloseError,
  type WebSocketOptions,
  defaultShouldReconnect,
  websocket,
} from '@atproto/ws-client'

export interface LiveTransport {
  // Yields raw frames (bytes or text). getUrl() is called once per
  // (re)connection so the resume cursor reflects the highest-delivered seq at
  // connect time. The returned iterable should reconnect internally and end
  // only on signal abort or a non-reconnectable error.
  stream(
    getUrl: () => string,
    signal: AbortSignal,
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
   * `false` disables idle detection.
   */
  idleTimeoutMs?: number | false
}

// A jetstream server closing 1000 (restart, load-shed) should not end the
// consumer's stream — the resume cursor makes the redial seamless. Everything
// else keeps ws-client's classification: protocol closes
// (1002/1003/1007/1009), DataModeError, and local resource errors stay fatal.
export function jetstreamShouldReconnect(error: unknown): boolean {
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
  return {
    ...rest,
    shouldReconnect,
    idleTimeoutMs: idleTimeoutMs === false ? undefined : idleTimeoutMs,
    dataMode: 'text',
  }
}

export function websocketTransport(
  options?: WebsocketTransportOptions,
): LiveTransport {
  const resolved = resolveWebsocketOptions(options)
  return {
    stream(getUrl, signal) {
      // getUrl is passed straight through: websocket() re-resolves a function
      // url on every (re)connection, which is exactly the resume-cursor
      // contract stream() requires.
      return websocket(getUrl, { ...resolved, signal })
    },
  }
}
