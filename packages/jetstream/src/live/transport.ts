import { WebSocketKeepAlive } from '@atproto/ws-client'

export interface LiveTransport {
  // Yields raw frame bytes. getUrl() is called once per (re)connection so the
  // resume cursor reflects the highest-delivered seq at connect time. The
  // returned iterable should reconnect internally and end only on signal abort
  // or a non-reconnectable error.
  stream(getUrl: () => string, signal: AbortSignal): AsyncIterable<Uint8Array>
}

const te = new TextEncoder()

export const wsKeepAliveTransport: LiveTransport = {
  async *stream(getUrl, signal) {
    const ka = new WebSocketKeepAlive({
      getUrl: async () => getUrl(),
      signal,
    })
    // Jetstream v1 sends WebSocket TEXT frames, which ws (in object mode)
    // yields as strings; binary frames arrive as bytes. The LiveTransport
    // contract is bytes, so normalize here.
    for await (const chunk of ka) {
      yield typeof chunk === 'string' ? te.encode(chunk) : chunk
    }
  },
}
