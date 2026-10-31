import { afterEach, describe, expect, test } from 'vitest'
import { WebSocketServer } from 'ws'
import { ProtocolError } from '../../src/errors.js'
import type { JetstreamProgress } from '../../src/event.js'
import { Jetstream } from '../../src/jetstream.js'
import {
  fakeArchive,
  fakeTransport,
  liveCommit,
  liveProgress,
  liveScope,
} from './fake-archive.js'

const ALICE = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const BOB = 'did:plc:4qtfnvqsjsl2bc6ut7ezqzhb'
const PROGRESS_ACK = {
  'jetstream-protocol-version': '2',
  'jetstream-progress': 'true',
}

async function collect<T>(
  it: AsyncIterable<T>,
  limit = Infinity,
): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) {
    out.push(v)
    if (out.length >= limit) break
  }
  return out
}
const summary = (
  evs: Array<{
    kind: string
    seq?: number
    throughSeq?: number
    caughtUp?: boolean
  }>,
) =>
  evs.map((e) =>
    e.kind === 'progress' ? `p${e.throughSeq}${e.caughtUp ? '!' : ''}` : e.seq,
  )

describe('Spaces live over a scripted transport', () => {
  const spaces = (transportFetch = fakeArchive().fetch) =>
    new Jetstream({
      service: 'https://archive.example',
      mode: 'spaces',
      fetchImpl: transportFetch,
    })

  test('requests protocol 2 and progress, and passes space and scope through', async () => {
    const transport = fakeTransport([
      {
        upgrade: PROGRESS_ACK,
        frames: [
          liveCommit(10, 'space:a'),
          liveScope(11, 'space:b', BOB),
          liveScope(12, 'space:c'),
          liveProgress(12, true),
        ],
      },
    ])
    const evs = await collect(
      spaces().live({ raw: true, progress: true, liveTransport: transport }),
    )
    expect(summary(evs)).toEqual([10, 11, 12, 'p12!'])
    expect(evs[0]).toMatchObject({ kind: 'commit', space: 'space:a' })
    expect(evs[2]).toMatchObject({
      kind: 'scope',
      space: 'space:c',
      scope: { operation: 'spaceDeleted' },
    })
    const url = transport.urls[0]
    expect(url.searchParams.get('protocolVersion')).toBe('2')
    expect(url.searchParams.get('progress')).toBe('true')
  })

  test('without progress the query omits it and progress frames are dropped', async () => {
    const transport = fakeTransport([
      { frames: [liveCommit(10), liveProgress(10, true)] },
    ])
    const evs = await collect(
      spaces().live({ raw: true, liveTransport: transport }),
    )
    expect(evs.map((e) => e.seq)).toEqual([10])
    expect(transport.urls[0].searchParams.has('progress')).toBe(false)
  })

  test('every reconnect is re-verified and keeps protocolVersion', async () => {
    const transport = fakeTransport([
      { upgrade: PROGRESS_ACK, frames: [liveCommit(10)] },
      {
        upgrade: { 'jetstream-protocol-version': '2' },
        frames: [liveCommit(11)],
      },
    ])
    const it = spaces().live({
      raw: true,
      progress: true,
      liveTransport: transport,
      cursor: undefined,
    })
    await expect(collect(it)).rejects.toThrow(/did not acknowledge it/)
    expect(transport.urls).toHaveLength(2)
    expect(transport.urls[1].searchParams.get('protocolVersion')).toBe('2')
    expect(transport.urls[1].searchParams.get('cursor')).toBe('10')
  })

  test('a wrong protocol header is a protocol error', async () => {
    const transport = fakeTransport([
      {
        upgrade: { 'jetstream-protocol-version': '1' },
        frames: [liveCommit(10)],
      },
    ])
    await expect(
      collect(spaces().live({ raw: true, liveTransport: transport })),
    ).rejects.toThrow(ProtocolError)
  })

  test('a transport that never reports the upgrade is rejected at the first frame', async () => {
    const transport = fakeTransport([{ frames: [liveCommit(10)] }], false)
    await expect(
      collect(spaces().live({ raw: true, liveTransport: transport })),
    ).rejects.toThrow(/did not report the WebSocket upgrade headers/)
  })

  test('progress never certifies past a skipped frame', async () => {
    const transport = fakeTransport([
      {
        upgrade: PROGRESS_ACK,
        frames: [
          liveProgress(9, false),
          liveFrame({
            $type: 'network.bsky.jetstream.subscribeEvents#future',
            seq: 10,
          }),
          liveCommit(11),
          liveProgress(11, true),
        ],
      },
    ])
    const evs = await collect(
      spaces().live({ raw: true, progress: true, liveTransport: transport }),
    )
    expect(summary(evs)).toEqual(['p9', 11])
  })

  test('public live never asks for protocolVersion', async () => {
    const transport = fakeTransport(
      [{ frames: [liveCommit(10, 'space:a'), liveScope(11, 'space:b', BOB)] }],
      false,
    )
    const archive = fakeArchive()
    const js = new Jetstream({
      service: 'https://archive.example',
      fetchImpl: archive.fetch,
    })
    const evs = await collect(js.live({ raw: true, liveTransport: transport }))
    expect(evs.map((e) => e.seq)).toEqual([10])
    expect(evs[0]).not.toHaveProperty('space')
    expect(transport.urls[0].searchParams.has('protocolVersion')).toBe(false)
    expect(archive.requests).toEqual([])
  })
})

const liveFrame = (payload: Record<string, unknown>) =>
  JSON.stringify({ $type: 'message', payload })

describe('Spaces replay: sealed archive then live', () => {
  test('progress is ordered and monotonic across the cutover', async () => {
    const archive = fakeArchive()
    const transport = fakeTransport([
      {
        upgrade: PROGRESS_ACK,
        // The live tail re-sends an already-sealed seq; it is deduplicated.
        frames: [
          liveProgress(8, false),
          liveCommit(9, 'space:a', ALICE),
          liveCommit(10, 'space:a'),
          liveProgress(10, true),
        ],
      },
    ])
    const js = new Jetstream({
      service: 'https://archive.example',
      mode: 'spaces',
      fetchImpl: archive.fetch,
    })
    const evs = await collect(
      js.replay({ raw: true, progress: true, liveTransport: transport }),
    )
    expect(summary(evs)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 'p9', 10, 'p10!'])
    expect(
      archive.requests.filter((r) =>
        r.url.pathname.endsWith('getCapabilities'),
      ),
    ).toHaveLength(1)
    expect(transport.urls[0].searchParams.get('cursor')).toBe('9')
    expect(transport.urls[0].searchParams.get('protocolVersion')).toBe('2')
  })

  test('the sealed sweep alone never reports caught up', async () => {
    const archive = fakeArchive()
    const js = new Jetstream({
      service: 'https://archive.example',
      mode: 'spaces',
      fetchImpl: archive.fetch,
    })
    const evs = await collect(js.snapshot({ raw: true, progress: true }))
    const progress = evs.filter(
      (e): e is JetstreamProgress => e.kind === 'progress',
    )
    expect(progress.every((p) => !p.caughtUp)).toBe(true)
  })
})

describe('the real WebSocket transport verifies upgrade headers', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  // protocolHeaders[i] is the Jetstream-Protocol-Version sent on connection
  // i (the last value repeats). The first connection closes after its frame
  // so the client reconnects.
  async function serve(protocolHeaders: string[]) {
    const wss = await new Promise<WebSocketServer>((resolve) => {
      const s: WebSocketServer = new WebSocketServer({ port: 0 }, () =>
        resolve(s),
      )
    })
    const addr = wss.address()
    if (addr === null || typeof addr === 'string') throw new Error('no port')
    let conn = 0
    const urls: string[] = []
    wss.on('headers', (headers) => {
      const value = protocolHeaders[Math.min(conn, protocolHeaders.length - 1)]
      headers.push(`Jetstream-Protocol-Version: ${value}`)
      conn++
    })
    wss.on('connection', (ws, req) => {
      urls.push(req.url ?? '')
      const n = urls.length
      ws.send(liveCommit(9 + n, 'space:a'))
      if (n === 1) ws.close(1000)
    })
    close = () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate()
        wss.close(() => resolve())
      })
    return { host: `http://127.0.0.1:${addr.port}`, urls }
  }
  const spacesAt = (host: string) =>
    new Jetstream({
      service: host,
      mode: 'spaces',
      fetchImpl: fakeArchive().fetch,
    })

  test('accepted upgrades stream, and the reconnect is checked again', async () => {
    const { host, urls } = await serve(['2'])
    const evs = await collect(spacesAt(host).live({ raw: true }), 2)
    expect(evs.map((e) => e.seq)).toEqual([10, 11])
    expect(urls).toHaveLength(2)
    for (const u of urls) expect(u).toContain('protocolVersion=2')
  })

  test('a mismatched protocol header ends the stream', async () => {
    const { host } = await serve(['3'])
    await expect(collect(spacesAt(host).live({ raw: true }))).rejects.toThrow(
      ProtocolError,
    )
  })

  test('a missing progress acknowledgement ends the stream', async () => {
    const { host } = await serve(['2'])
    await expect(
      collect(spacesAt(host).live({ raw: true, progress: true })),
    ).rejects.toThrow(/did not acknowledge it/)
  })

  test('a reconnect whose upgrade regresses is rejected', async () => {
    const { host, urls } = await serve(['2', '1'])
    const seen: number[] = []
    const run = async () => {
      for await (const e of spacesAt(host).live({ raw: true })) seen.push(e.seq)
    }
    await expect(run()).rejects.toThrow(ProtocolError)
    expect(seen).toEqual([10])
    expect(urls).toHaveLength(2)
  })
})
