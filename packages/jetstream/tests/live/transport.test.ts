import { DataModeError } from '@atproto/ws-client'
import { describe, expect, it, vi } from 'vitest'
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

  it('reconnects on a clean 1000 close by default, resuming from the cursor', async () => {
    const srv = await serveScript([
      (ws) => {
        ws.send(v1Frame(100))
        ws.close(1000)
      },
      (ws) => {
        ws.send(v1Frame(200))
        // stay open; the test ends by aborting
      },
    ])
    try {
      const ac = new AbortController()
      const got: number[] = []
      await expect(
        (async () => {
          // Default transport on purpose: pins that liveEvents' default IS
          // websocketTransport() with the jetstream reconnect policy.
          for await (const ev of liveEvents({
            host: srv.host,
            signal: ac.signal,
          })) {
            got.push(ev.seq)
            if (ev.seq === 200) ac.abort(new Error('test done'))
          }
        })(),
      ).rejects.toThrow('test done')
      expect(got).toEqual([100, 200])
      expect(srv.urls).toHaveLength(2)
      expect(srv.urls[1]).toContain('cursor=100') // getUrl re-resolved with resume cursor
    } finally {
      await srv.close()
    }
  }, 10_000)

  it('surfaces retried failures via onReconnect and redials after an abnormal drop', async () => {
    const conns: WebSocket[] = []
    const srv = await serveScript([
      (ws) => {
        conns.push(ws)
        ws.send(v1Frame(100))
        // terminated from the test body after the frame is observed —
        // avoids racing the frame against the drop
      },
      (ws) => {
        ws.send(v1Frame(200))
      },
    ])
    try {
      const onReconnect = vi.fn()
      const ac = new AbortController()
      const got: number[] = []
      await expect(
        (async () => {
          for await (const ev of liveEvents({
            host: srv.host,
            signal: ac.signal,
            transport: websocketTransport({ onReconnect }),
          })) {
            got.push(ev.seq)
            if (ev.seq === 100) conns[0].terminate() // abnormal close, no close frame
            if (ev.seq === 200) ac.abort(new Error('test done'))
          }
        })(),
      ).rejects.toThrow('test done')
      expect(got).toEqual([100, 200])
      expect(onReconnect).toHaveBeenCalled()
      expect(onReconnect.mock.calls[0][1]).toEqual({ attempt: 0 })
    } finally {
      await srv.close()
    }
  }, 10_000)

  it('idle timeout redials a silent connection', async () => {
    const srv = await serveScript([
      () => {
        // first connection: send nothing; the 50ms idle timeout should trip
        // (IdleTimeoutError is retryable -> redial, not stream end)
      },
      (ws) => {
        ws.send(v1Frame(100))
      },
    ])
    try {
      const ac = new AbortController()
      const got: number[] = []
      await expect(
        (async () => {
          for await (const ev of liveEvents({
            host: srv.host,
            signal: ac.signal,
            transport: websocketTransport({ idleTimeoutMs: 50 }),
          })) {
            got.push(ev.seq)
            ac.abort(new Error('test done'))
          }
        })(),
      ).rejects.toThrow('test done')
      expect(got).toEqual([100])
      expect(srv.urls.length).toBeGreaterThanOrEqual(2)
    } finally {
      await srv.close()
    }
  }, 10_000)

  it('a binary frame is fatal (DataModeError), not reconnected', async () => {
    const srv = await serveScript([
      (ws) => {
        ws.send(Buffer.from(v1Frame(100))) // Buffer => binary frame on a text stream
      },
    ])
    try {
      await expect(
        (async () => {
          for await (const ev of liveEvents({ host: srv.host })) {
            void ev // no events expected
          }
        })(),
      ).rejects.toBeInstanceOf(DataModeError)
      expect(srv.urls).toHaveLength(1) // fatal: no redial
    } finally {
      await srv.close()
    }
  }, 10_000)
})
