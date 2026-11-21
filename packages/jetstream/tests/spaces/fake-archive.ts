import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  LiveTransport,
  LiveTransportOpts,
} from '../../src/live/transport.js'
import { readSealedHeader } from '../../src/segment/header.js'
import { readBlockFrame } from '../../src/segment/segment-reader.js'

// A fake space-sync archive over the Go-produced v2 fixture segment (seq 1..9,
// three blocks of three rows), enforcing the server's version contract: every
// request but getCapabilities must carry protocolVersion=2, and every success
// echoes the negotiated headers (each overridable to simulate a misbehaving
// server). Requests are recorded for assertions.

export const SEGMENT = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/spaces_seal_v2.bin', import.meta.url)),
  ),
)
const header = readSealedHeader(SEGMENT, 2)
export const ETAG = '"0123456789abcdef"'

export const CAPABILITIES = {
  protocolVersions: [1, 2],
  formatVersions: [1, 2],
  requiredProtocolVersion: 2,
  eventKinds: ['commit', 'identity', 'account', 'sync', 'scope'],
}

export interface FakeArchiveOpts {
  /** Plan entry mode: whole segment or every block. Default 'segment'. */
  mode?: 'segment' | 'blocks'
  /** getCapabilities body, or a Response to return instead. */
  capabilities?: unknown
  /** Jetstream-Protocol-Version on successes; null omits it. Default '2'. */
  protocolHeader?: string | null
  /** Jetstream-Format-Version on artifacts; null omits it. Default '2'. */
  formatHeader?: string | null
  /** Plan entry formatVersion; null omits it. Default 2. */
  planFormatVersion?: number | null
  /** Sealed tip; 0 serves an empty archive. Default 9. */
  sealedTip?: number
  /** Break the first getSegment body after this many bytes. */
  breakSegmentAfter?: number
  /** Header overrides applied only to a resumed (206) getSegment. */
  resumeHeaders?: Record<string, string | null>
  /** Fail this many getBlock requests with HTTP 500 first. */
  failBlocks?: number
}

export interface RecordedRequest {
  method: string
  url: URL
  body?: Record<string, unknown>
  headers: Headers
}

const json = (body: unknown, status = 200, headers?: Headers) => {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: h })
}

export function fakeArchive(opts: FakeArchiveOpts = {}) {
  const requests: RecordedRequest[] = []
  let segmentBreaks = opts.breakSegmentAfter !== undefined ? 1 : 0
  let blockFailures = opts.failBlocks ?? 0
  const negotiated = (
    format: boolean,
    overrides?: FakeArchiveOpts['resumeHeaders'],
  ) => {
    const h = new Headers()
    const set = (name: string, value: string | null | undefined) => {
      if (value !== null && value !== undefined) h.set(name, value)
    }
    set(
      'jetstream-protocol-version',
      opts.protocolHeader === undefined ? '2' : opts.protocolHeader,
    )
    if (format) {
      set(
        'jetstream-format-version',
        opts.formatHeader === undefined ? '2' : opts.formatHeader,
      )
    }
    for (const [name, value] of Object.entries(overrides ?? {})) {
      if (value === null) h.delete(name)
      else h.set(name, value)
    }
    return h
  }
  const requireVersion = (u: URL): Response | undefined =>
    u.searchParams.get('protocolVersion') === '2'
      ? undefined
      : json(
          {
            error: 'InvalidRequest',
            message: 'this archive requires protocolVersion=2',
          },
          400,
        )

  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const body =
      req.method === 'POST'
        ? ((await req.json()) as Record<string, unknown>)
        : undefined
    requests.push({ method: req.method, url, body, headers: req.headers })
    const method = url.pathname.replace('/xrpc/network.bsky.jetstream.', '')

    if (method === 'getCapabilities') {
      if (opts.capabilities instanceof Response) return opts.capabilities
      return json(opts.capabilities ?? CAPABILITIES)
    }
    if (method === 'planSnapshot') {
      if (body?.protocolVersion !== 2) {
        return json(
          {
            error: 'InvalidRequest',
            message: 'this archive requires protocolVersion=2',
          },
          400,
        )
      }
      const tip = opts.sealedTip ?? 9
      const afterSeq = Number(body.afterSeq ?? 0)
      const entry = {
        name: 'seg_0000000000.jss',
        index: 0,
        checksum: '0123456789abcdef',
        ...(opts.planFormatVersion === null
          ? {}
          : { formatVersion: opts.planFormatVersion ?? 2 }),
        minSeq: 1,
        maxSeq: 9,
        ...(opts.mode === 'blocks'
          ? {
              mode: 'blocks',
              blocks: [{ first: 0, last: header.blockCount - 1 }],
            }
          : { mode: 'segment' }),
      }
      return json(
        {
          plannedThroughSeq: tip,
          sealedTipSeq: tip,
          segments: tip > 0 && afterSeq < 9 ? [entry] : [],
          stats: {
            segmentsExamined: 1,
            segmentsMatched: 1,
            blocksMatched: 3,
            entries: 1,
          },
        },
        200,
        negotiated(false),
      )
    }
    if (method === 'getSegment') {
      const bad = requireVersion(url)
      if (bad) return bad
      const range = req.headers.get('range')
      if (range) {
        const start = Number(/bytes=(\d+)-/.exec(range)![1])
        const h = negotiated(true, opts.resumeHeaders)
        h.set(
          'content-range',
          `bytes ${start}-${SEGMENT.length - 1}/${SEGMENT.length}`,
        )
        h.set('etag', ETAG)
        return new Response(SEGMENT.slice(start), { status: 206, headers: h })
      }
      const h = negotiated(true)
      h.set('etag', ETAG)
      if (segmentBreaks > 0) {
        segmentBreaks--
        const cut = opts.breakSegmentAfter!
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(SEGMENT.slice(0, cut))
          },
          pull(c) {
            c.error(new TypeError('socket reset'))
          },
        })
        return new Response(stream, { status: 200, headers: h })
      }
      return new Response(SEGMENT, { status: 200, headers: h })
    }
    if (method === 'getBlock') {
      const bad = requireVersion(url)
      if (bad) return bad
      if (blockFailures > 0) {
        blockFailures--
        return json({ error: 'InternalServerError' }, 500)
      }
      const idx = Number(url.searchParams.get('blockIndex'))
      return new Response(readBlockFrame(SEGMENT, header, idx), {
        status: 200,
        headers: negotiated(true),
      })
    }
    throw new Error(`unexpected request ${url}`)
  }) as typeof fetch

  return { fetch: fetchImpl, requests }
}

/**
 * A scripted live transport: each connection reports `upgrade` headers (when
 * the stream asks for verification), then yields that connection's frames.
 * The stream ends after the last connection. Records every dialed URL.
 */
export function fakeTransport(
  connections: Array<{
    frames: string[]
    upgrade?: Record<string, string>
    /** Throw after the frames instead of moving to the next connection. */
    error?: Error
  }>,
  reportUpgrade = true,
): LiveTransport & { urls: URL[] } {
  const urls: URL[] = []
  return {
    urls,
    async *stream(
      getUrl: () => string,
      _signal: AbortSignal,
      opts?: LiveTransportOpts,
    ) {
      for (const conn of connections) {
        urls.push(new URL(getUrl()))
        if (reportUpgrade) {
          opts?.onUpgrade?.(
            new Headers(conn.upgrade ?? { 'jetstream-protocol-version': '2' }),
          )
        }
        for (const f of conn.frames) yield f
        if (conn.error) throw conn.error
      }
    },
  }
}

const NSID = 'network.bsky.jetstream.subscribeEvents'
export const liveFrame = (payload: Record<string, unknown>) =>
  JSON.stringify({ $type: 'message', payload })
export const liveCommit = (
  seq: number,
  space?: string,
  did = 'did:plc:yk4dd2qkboz2yv6tpubpc6co',
) =>
  liveFrame({
    $type: `${NSID}#commit`,
    seq,
    did,
    ...(space ? { space } : {}),
    time: '2026-10-31T12:00:00.010000Z',
    rev: '3l3qo2vuzzz2b',
    operation: 'create',
    collection: 'app.example.note',
    rkey: '3l3qo2vutsw2b',
    cid: 'bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi',
    record: { $type: 'app.example.note', text: 'x' },
  })
export const liveProgress = (throughSeq: number, caughtUp: boolean) =>
  liveFrame({ $type: `${NSID}#progress`, throughSeq, caughtUp })
export const liveScope = (seq: number, space: string, did?: string) =>
  liveFrame({
    $type: `${NSID}#scope`,
    seq,
    time: '2026-10-31T12:00:00.012000Z',
    space,
    operation: did ? 'repoRemoved' : 'spaceDeleted',
    ...(did ? { did } : {}),
  })
