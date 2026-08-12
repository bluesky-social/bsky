import { expect, test } from 'vitest'
import { type LiveTransport, liveEvents } from '../../src/live/source.js'

const commitFrame = (time_us: number) =>
  JSON.stringify({
    did: 'did:plc:a',
    time_us,
    kind: 'commit',
    commit: {
      rev: 'r',
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: `k${time_us}`,
      record: { $type: 'app.bsky.feed.post', text: String(time_us) },
      cid: 'cid1',
    },
  })

// A transport that replays scripted "sessions": each session is a list of
// frames; a new session begins on each getUrl() call (i.e. each reconnect).
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
        const frames = sessions[i++]
        for (const f of frames) yield new TextEncoder().encode(f)
        // session ends -> loop calls getUrl again (simulates reconnect) until sessions exhausted
      }
    },
  }
  return { transport, urls }
}

test('yields decoded events and dedups across a reconnect', async () => {
  // session 1: seqs 1,2 ; session 2 (reconnect, inclusive replay): 2,3,4
  const { transport, urls } = scriptedTransport([
    [commitFrame(1), commitFrame(2)],
    [commitFrame(2), commitFrame(3), commitFrame(4)],
  ])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    version: 1,
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([1, 2, 3, 4]) // the replayed seq 2 is deduped
  // second session's url resumes from the highest delivered seq (2)
  expect(urls[1]).toContain('cursor=2')
})

test('builds the subscribe url with filters (no extended param)', async () => {
  const { transport, urls } = scriptedTransport([[commitFrame(1)]])
  for await (const _ of liveEvents({
    host: 'https://h',
    collections: ['app.bsky.feed.post'],
    dids: ['did:plc:a'],
    transport,
    version: 1,
  })) {
    void _
  }
  expect(urls[0]).toContain('/subscribe')
  expect(urls[0]).not.toContain('subscribe-v2')
  expect(urls[0]).not.toContain('extended')
  expect(urls[0]).toContain('wantedCollections=app.bsky.feed.post')
  expect(urls[0]).toContain('wantedDids=did%3Aplc%3Aa')
  expect(urls[0]).toMatch(/^wss:/) // https -> wss
})

test('cursor undefined omits the param (live from tip); 0 sends cursor=0', async () => {
  const a = scriptedTransport([[commitFrame(1)]])
  for await (const _ of liveEvents({
    host: 'https://h',
    transport: a.transport,
    version: 1,
  }))
    void _
  expect(a.urls[0]).not.toContain('cursor=')

  const b = scriptedTransport([[commitFrame(1)]])
  for await (const _ of liveEvents({
    host: 'https://h',
    cursor: 0,
    transport: b.transport,
    version: 1,
  }))
    void _
  expect(b.urls[0]).toContain('cursor=0')
})

test('signal-driven teardown: aborting the signal stops iteration', async () => {
  const ac = new AbortController()
  // Transport that yields one frame, then checks the signal before yielding more.
  // This keeps the test deterministic: no real timers, no races.
  const transport: LiveTransport = {
    async *stream(_getUrl, signal) {
      yield new TextEncoder().encode(commitFrame(1))
      // After the first frame is consumed the test aborts; honour it here.
      if (signal.aborted) return
      yield new TextEncoder().encode(commitFrame(2))
    },
  }
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    transport,
    signal: ac.signal,
    version: 1,
  })) {
    got.push(ev.seq)
    // Abort after the first event; the transport will see signal.aborted on next iteration.
    ac.abort()
  }
  expect(got).toEqual([1]) // only the pre-abort frame was delivered; loop terminated
})

test('dedupFloor drops events at or below it; undefined lets seq 0 pass', async () => {
  const a = scriptedTransport([[commitFrame(0), commitFrame(1)]])
  const gotA: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: undefined,
    transport: a.transport,
    version: 1,
  }))
    gotA.push(ev.seq)
  expect(gotA).toEqual([0, 1]) // seq 0 passes when floor is undefined

  const b = scriptedTransport([[commitFrame(0), commitFrame(1)]])
  const gotB: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: 0,
    transport: b.transport,
    version: 1,
  }))
    gotB.push(ev.seq)
  expect(gotB).toEqual([1]) // seq 0 dropped when floor is 0
})

test('dedup on reconnect overlap is exact (unique monotonic time_us)', async () => {
  const { transport } = scriptedTransport([
    [commitFrame(100), commitFrame(101)],
  ])
  const events = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: 100, // as if 100 already delivered
    transport,
    version: 1,
  })) {
    events.push(ev)
  }
  expect(events.map((e) => e.seq)).toEqual([101]) // 100 dropped (<= floor)
})

test('v1 seeds the dedup floor even for timestamp-magnitude values', async () => {
  // v1's seq IS time_us, so a large floor is a real seq — it must still dedup.
  const floor = 1_700_000_000_000_000
  const { transport } = scriptedTransport([
    [commitFrame(floor), commitFrame(floor + 1)],
  ])
  const got: number[] = []
  for await (const ev of liveEvents({
    host: 'https://h',
    dedupFloor: floor,
    transport,
    version: 1,
  })) {
    got.push(ev.seq)
  }
  expect(got).toEqual([floor + 1])
})
