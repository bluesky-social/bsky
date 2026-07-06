import { once } from 'node:events'
import { expect, test } from 'vitest'
import { WebSocketServer } from 'ws'
import { wsKeepAliveTransport } from '../../src/live/transport.js'

// Jetstream v1 sends TEXT frames; ws yields those as strings, and the
// transport must normalize them to bytes (regression: strings crashed
// TextDecoder in the decoder downstream). Binary frames pass through.
test('wsKeepAliveTransport yields bytes for both text and binary frames', async () => {
  const wss = new WebSocketServer({ port: 0 })
  await once(wss, 'listening')
  const { port } = wss.address() as { port: number }
  wss.on('connection', (ws) => {
    ws.send('{"kind":"text-frame"}') // text frame -> string in object mode
    ws.send(new TextEncoder().encode('{"kind":"binary-frame"}')) // binary frame
  })

  const ac = new AbortController()
  const seen: string[] = []
  try {
    for await (const chunk of wsKeepAliveTransport.stream(
      () => `ws://127.0.0.1:${port}/`,
      ac.signal,
    )) {
      expect(chunk).toBeInstanceOf(Uint8Array)
      seen.push(new TextDecoder().decode(chunk))
      if (seen.length >= 2) ac.abort()
    }
  } catch (err) {
    if (!ac.signal.aborted) throw err // abort-driven teardown is expected
  } finally {
    wss.close()
  }
  expect(seen).toEqual(['{"kind":"text-frame"}', '{"kind":"binary-frame"}'])
})
