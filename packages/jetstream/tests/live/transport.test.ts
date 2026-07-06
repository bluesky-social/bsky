import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { liveEvents } from '../../src/live/source.js'

// End-to-end over a real websocket: jetstream frames are text frames, which
// ws-client yields as strings, not Uint8Array — see the NOTE in
// src/live/transport.ts. Exercises the real wsKeepAliveTransport so the
// decoder's string handling can't regress even when fake-transport tests pass.

const v1Frame = JSON.stringify({
  did: 'did:plc:a',
  time_us: 100,
  kind: 'commit',
  commit: {
    rev: 'r',
    operation: 'create',
    collection: 'app.bsky.feed.like',
    rkey: 'rk1',
    record: { $type: 'app.bsky.feed.like' },
    cid: 'cid1',
  },
})

function serveFrames(frames: string[]): Promise<{ port: number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address()
      if (addr === null || typeof addr === 'string')
        throw new Error('no server port')
      resolve({ port: addr.port })
    })
    wss.on('connection', (ws) => {
      for (const f of frames) ws.send(f) // text frames, like jetstream
      ws.close(1000) // clean close ends the keep-alive stream without reconnect
      wss.close()
    })
  })
}

describe('wsKeepAliveTransport (real websocket)', () => {
  it('delivers v1 text frames through liveEvents', async () => {
    const { port } = await serveFrames([v1Frame])
    const events = []
    const errors: Error[] = []
    for await (const ev of liveEvents({
      host: `http://127.0.0.1:${port}`,
      onError: (err) => errors.push(err),
    })) {
      events.push(ev)
    }
    expect(errors).toEqual([])
    expect(events.map((e) => e.seq)).toEqual([100])
  })
})
