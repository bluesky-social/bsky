import { type Server, createServer } from 'node:http'
import { afterEach, expect, test } from 'vitest'
import { liveEvents } from '../../src/live/source.js'

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise((res) => server!.close(() => res(undefined)))
  server = undefined
})

test('a pre-upgrade 400 ends the stream after exactly one dial', async () => {
  let dials = 0
  server = createServer((_req, res) => {
    dials++
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'CursorTooOld', message: 'too old' }))
  })
  const port = await new Promise<number>((res) => {
    server!.listen(0, () => {
      const addr = server!.address()
      res(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })

  await expect(async () => {
    for await (const _ of liveEvents({ host: `http://127.0.0.1:${port}` })) {
      void _
    }
  }).rejects.toThrow()

  // The whole point: a permanent rejection must not become a redial loop.
  expect(dials).toBe(1)
})
