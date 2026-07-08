import { WebSocketKeepAlive } from '@atproto/ws-client'

export interface LiveTransport {
  // Yields raw frame bytes. getUrl() is called once per (re)connection so the
  // resume cursor reflects the highest-delivered seq at connect time. The
  // returned iterable should reconnect internally and end only on signal abort
  // or a non-reconnectable error.
  stream(getUrl: () => string, signal: AbortSignal): AsyncIterable<Uint8Array>
}

// NOTE: WebSocketKeepAlive declares AsyncGenerator<Uint8Array> but actually
// yields strings for websocket text frames — and jetstream sends JSON as
// text. This is why the decoder accepts Uint8Array | string; once ws-client
// fixes its frame typing this can tighten to Uint8Array-only.
// tests/live/transport.test.ts pins the behavior over a real websocket.
export const wsKeepAliveTransport: LiveTransport = {
  stream(getUrl, signal) {
    return new WebSocketKeepAlive({
      getUrl: async () => getUrl(),
      signal,
    })
  },
}
