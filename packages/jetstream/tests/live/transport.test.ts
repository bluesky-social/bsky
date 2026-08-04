import { describe, expect, it } from 'vitest'
import { type WebSocket, WebSocketServer } from 'ws'
import { liveEvents } from '../../src/live/source.js'
import { websocketTransport } from '../../src/live/transport.js'

// End-to-end over a real websocket: jetstream frames are text frames, which
// the transport (dataMode 'text') yields as strings. Exercises the real
// websocketTransport so the decoder's string handling can't regress even
// when fake-transport tests pass.

export const v1Frame = (time_us: number) =>
  JSON.stringify({
    did: 'did:plc:a',
    time_us,
    kind: 'commit',
    commit: {
      rev: 'r',
      operation: 'create',
      collection: 'app.bsky.feed.like',
      rkey: `rk${time_us}`,
      record: { $type: 'app.bsky.feed.like' },
      cid: 'cid1',
    },
  })

// Scripted server: one handler per expected connection, in order. Requests
// beyond the script are dropped immediately (a reconnecting client retries
// until the test aborts). urls records each connection's request path.
export async function serveScript(script: Array<(ws: WebSocket) => void>) {
  const wss = await new Promise<WebSocketServer>((resolve) => {
    const server: WebSocketServer = new WebSocketServer({ port: 0 }, () =>
      resolve(server),
    )
  })
  const addr = wss.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  const urls: string[] = []
  let i = 0
  wss.on('connection', (ws, req) => {
    urls.push(req.url ?? '')
    const session = script[i++]
    if (session) session(ws)
    else ws.terminate()
  })
  return {
    host: `http://127.0.0.1:${addr.port}`,
    urls,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate()
        wss.close(() => resolve())
      }),
  }
}

describe('websocketTransport (real websocket)', () => {
  it('delivers v1 text frames; shouldReconnect: false ends on clean close', async () => {
    const srv = await serveScript([
      (ws) => {
        ws.send(v1Frame(100))
        ws.close(1000)
      },
    ])
    try {
      const events = []
      const errors: Error[] = []
      for await (const ev of liveEvents({
        host: srv.host,
        transport: websocketTransport({ shouldReconnect: false }),
        onError: (err) => errors.push(err),
      })) {
        events.push(ev)
      }
      expect(errors).toEqual([])
      expect(events.map((e) => e.seq)).toEqual([100])
      expect(srv.urls).toHaveLength(1) // no redial
    } finally {
      await srv.close()
    }
  })
})
