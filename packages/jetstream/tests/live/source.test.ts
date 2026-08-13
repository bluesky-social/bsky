import { expect, test } from 'vitest'
import { type LiveTransport, liveEvents } from '../../src/live/source.js'

const NSID = 'network.bsky.jetstream.subscribeEvents'
const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'
// A well-formed TID (13-char base32-sortable) — wire-valid even though no
// test here enables validateWire, so a strict-mode test added later doesn't
// fail on this fixture for an unrelated reason.
const TID = '3jzfcijpj2z2a'

const commitFrame = (seq: number): string =>
  JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#commit`,
      seq,
      did: 'did:plc:a',
      time: '2024-09-09T19:46:02.329308Z',
      rev: TID,
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: `k${seq}`,
      cid: CID,
      record: { $type: 'app.bsky.feed.post', text: String(seq) },
    },
  })

const infoFrame = (name: string): string =>
  JSON.stringify({
    $type: 'message',
    payload: { $type: `${NSID}#info`, name, message: 'clamped' },
  })

// Replays scripted sessions; a new session begins on each getUrl() call, which
// is how a reconnect looks from here.
function scriptedTransport(sessions: string[][]): {
  transport: LiveTransport
  urls: string[]
} {
  const urls: string[] = []
  let i = 0
  const transport: LiveTransport = {
    async *stream(getUrl) {
      while (i < sessions.length) {
        urls.push(getUrl())
        for (const f of sessions[i++]) yield f
      }
    },
  }
  return { transport, urls }
}

test('defaults to the v2 endpoint and params', async () => {
  const { transport, urls } = scriptedTransport([[commitFrame(1)]])
  for await (const _ of liveEvents({
    host: 'https://h',
    collections: ['app.bsky.feed.post'],
    dids: ['did:plc:a' as never],
    kinds: ['commit', 'identity'],
    transport,
  })) {
    void _
  }
  expect(urls[0]).toContain(`/xrpc/${NSID}`)
  expect(urls[0]).toContain('collections=app.bsky.feed.post')
  expect(urls[0]).toContain('dids=did%3Aplc%3Aa')
  expect(urls[0]).toContain('kinds=commit')
  expect(urls[0]).toContain('kinds=identity')
  // The v1 vocabulary must never appear: v2 answers those names with a 400.
  expect(urls[0]).not.toContain('wantedCollections')
  expect(urls[0]).not.toContain('wantedDids')
  expect(urls[0]).not.toContain('/subscribe?')
  expect(urls[0]).toMatch(/^wss:/)
})

test('decodes events and dedups across a reconnect', async () => {
  const { transport, urls } = scriptedTransport([
    [commitFrame(1), commitFrame(2)],
    [commitFrame(2), commitFrame(3)],
  ])
  const got: number[] = []
  for await (const ev of liveEvents({ host: 'https://h', transport })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1, 2, 3])
  expect(urls[1]).toContain('cursor=2')
})

test('cursor undefined omits the param; 0 sends cursor=0', async () => {
  const a = scriptedTransport([[commitFrame(1)]])
  for await (const _ of liveEvents({
    host: 'https://h',
    transport: a.transport,
  }))
    void _
  expect(a.urls[0]).not.toContain('cursor=')

  const b = scriptedTransport([[commitFrame(1)]])
  for await (const _ of liveEvents({
    host: 'https://h',
    cursor: 0,
    transport: b.transport,
  }))
    void _
  expect(b.urls[0]).toContain('cursor=0')
})

test('a timestamp-domain cursor is wire-only and never seeds the dedup floor', async () => {
  // >= 1e15 is a unix-µs timestamp to the server, not a seq. Seeding the floor
  // with it would make every real seq compare as a duplicate.
  const ts = 1_700_000_000_000_000
  const { transport, urls } = scriptedTransport([
    [commitFrame(1), commitFrame(2)],
    [commitFrame(3)],
  ])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    cursor: ts,
    dedupFloor: ts,
    transport,
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1, 2, 3])
  expect(urls[0]).toContain(`cursor=${ts}`)
  // Once something is delivered the resume cursor is a real seq.
  expect(urls[1]).toContain('cursor=2')
})

test('a dedupFloor exactly at the timestamp-domain threshold is not seeded', async () => {
  // 1e15 itself is still the timestamp domain (>=), so it must not seed
  // lastSeq — seeding it would make every real (small integer) seq compare
  // as a duplicate forever.
  const threshold = 1e15
  const { transport } = scriptedTransport([[commitFrame(1), commitFrame(2)]])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: threshold,
    transport,
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1, 2])
})

test('a dedupFloor just below the timestamp-domain threshold seeds the floor', async () => {
  // 1e15 - 1 is still in the seq domain, so it seeds lastSeq like any other
  // seq-domain floor and every event compares against it.
  const belowThreshold = 1e15 - 1
  const { transport } = scriptedTransport([[commitFrame(1), commitFrame(2)]])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: belowThreshold,
    transport,
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([])
})

test('a seq-domain dedupFloor drops events at or below it', async () => {
  const { transport } = scriptedTransport([[commitFrame(5), commitFrame(6)]])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: 5,
    transport,
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([6])
})

test('an #info advisory reaches onInfo (not onError) and the stream continues', async () => {
  const { transport } = scriptedTransport([
    [infoFrame('OutdatedCursor'), commitFrame(1)],
  ])
  const errors: Error[] = []
  const infos: Array<{ name: string; message?: string }> = []
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    onError: (e) => errors.push(e),
    onInfo: (info) => infos.push(info),
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1])
  expect(errors).toEqual([])
  expect(infos).toEqual([{ name: 'OutdatedCursor', message: 'clamped' }])
})

test('an #info advisory is dropped silently when no onInfo is registered', async () => {
  const { transport } = scriptedTransport([
    [infoFrame('OutdatedCursor'), commitFrame(1)],
  ])
  const errors: Error[] = []
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    onError: (e) => errors.push(e),
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1])
  expect(errors).toEqual([])
})

test('an error frame is reported and the transport may redial', async () => {
  const errorFrame = JSON.stringify({
    $type: 'error',
    error: 'ConsumerTooSlow',
    message: 'too slow',
  })
  const { transport } = scriptedTransport([[errorFrame], [commitFrame(1)]])
  const errors: Error[] = []
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    onError: (e) => errors.push(e),
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1])
  expect(errors[0].name).toBe('XrpcSubscriptionError')
})

test('validateWire makes a malformed frame fatal', async () => {
  const bad = JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#commit`,
      seq: 1,
      did: 'not-a-did',
      time: '2024-09-09T19:46:02.329308Z',
      rev: TID,
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: 'k1',
      cid: CID,
      record: { $type: 'app.bsky.feed.post' },
    },
  })
  const { transport } = scriptedTransport([[bad]])
  await expect(async () => {
    for await (const _ of liveEvents({
      host: 'https://h',
      transport,
      validateWire: true,
    }))
      void _
  }).rejects.toThrow(/wire validation failed/)
})

test('rejects the kinds filter on v1', async () => {
  const { transport } = scriptedTransport([[commitFrame(1)]])
  await expect(async () => {
    for await (const _ of liveEvents({
      host: 'https://h',
      transport,
      version: 1,
      kinds: ['commit'],
    }))
      void _
  }).rejects.toThrow(/does not support the kinds filter/)
})

test('rejects parameter lists the server would refuse pre-upgrade', async () => {
  const { transport } = scriptedTransport([[commitFrame(1)]])
  const run = async (opts: Parameters<typeof liveEvents>[0]) => {
    for await (const _ of liveEvents(opts)) void _
  }
  await expect(
    run({
      host: 'https://h',
      transport,
      dids: Array.from({ length: 10_001 }, (_, i) => `did:plc:${i}` as never),
    }),
  ).rejects.toThrow(RangeError)
  await expect(
    run({
      host: 'https://h',
      transport,
      collections: Array.from({ length: 101 }, (_, i) => `app.test.c${i}`),
    }),
  ).rejects.toThrow(RangeError)
  await expect(
    run({
      host: 'https://h',
      transport,
      kinds: ['commit', 'commit', 'commit', 'commit', 'commit'],
    }),
  ).rejects.toThrow(RangeError)
})

test('rejects a collections filter that can never apply (kinds excludes commit)', async () => {
  // The server refuses this pair pre-upgrade with a 400 the default websocket
  // transport cannot read the body of; inside a replay cutover a bare 400 is
  // even classified as cursor-too-old and burns the re-plan budget. Say why
  // here instead.
  const { transport, urls } = scriptedTransport([[commitFrame(1)]])
  await expect(async () => {
    for await (const _ of liveEvents({
      host: 'https://h',
      transport,
      collections: ['app.bsky.feed.post'],
      kinds: ['account'],
    }))
      void _
  }).rejects.toThrow(/can never apply/)
  expect(urls).toEqual([]) // never dialed
})

test('accepts collections together with a kinds list that includes commit', async () => {
  const { transport, urls } = scriptedTransport([[commitFrame(1)]])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    collections: ['app.bsky.feed.post'],
    kinds: ['commit', 'account'],
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1])
  expect(urls[0]).toContain('collections=app.bsky.feed.post')
})

test('signal abort stops iteration', async () => {
  const ac = new AbortController()
  const transport: LiveTransport = {
    async *stream(_getUrl, signal) {
      yield commitFrame(1)
      if (signal.aborted) return
      yield commitFrame(2)
    },
  }
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    signal: ac.signal,
  })) {
    got.push(ev.seq)
    ac.abort()
  }
  expect(got).toEqual([1])
})
