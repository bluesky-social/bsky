import { l, record } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'
import { Jetstream } from '../../src/index.js'
import { type LiveTransport } from '../../src/live/transport.js'

const NSID = 'network.bsky.jetstream.subscribeEvents'
const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'
const TIME = '2024-09-09T19:46:02.329308Z'
// A well-formed TID (13-char base32-sortable) — required so the strict-mode
// test below (which is about `did`, not `rev`) doesn't spuriously fail on it.
const TID = '3jzfcijpj2z2a'

const deleteFrame = (seq: number): string =>
  JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#commit`,
      seq,
      did: 'did:plc:a',
      time: TIME,
      rev: TID,
      operation: 'delete',
      collection: 'app.test.rec',
      rkey: `r${seq}`,
    },
  })

const putFrame = (seq: number, rec: unknown): string =>
  JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#commit`,
      seq,
      did: 'did:plc:a',
      time: TIME,
      rev: TID,
      operation: 'create',
      collection: 'app.test.rec',
      rkey: `r${seq}`,
      cid: CID,
      record: rec,
    },
  })

const syncFrame = (seq: number): string =>
  JSON.stringify({
    $type: 'message',
    payload: {
      $type: `${NSID}#sync`,
      seq,
      did: 'did:plc:a',
      time: TIME,
      sync: { did: 'did:plc:a', rev: TID },
    },
  })

function fakeTransport(frames: string[]): LiveTransport & { urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    async *stream(getUrl) {
      urls.push(getUrl())
      for (const f of frames) yield f
    },
  }
}

describe('Jetstream.live (v2)', () => {
  it('dials the v2 endpoint by default', async () => {
    const t = fakeTransport([deleteFrame(1)])
    const js = new Jetstream({ service: 'https://js.example' })
    for await (const _ of js.live({ liveTransport: t })) void _
    expect(t.urls[0]).toContain(`/xrpc/${NSID}`)
  })

  it('yields one typed event per frame', async () => {
    const js = new Jetstream('https://js.example')
    const out: number[] = []
    for await (const evt of js.live({
      liveTransport: fakeTransport([
        deleteFrame(1),
        deleteFrame(2),
        deleteFrame(3),
      ]),
    })) {
      out.push(evt.seq)
    }
    expect(out).toEqual([1, 2, 3])
  })

  it('delivers sync events', async () => {
    const js = new Jetstream('https://js.example')
    const kinds: string[] = []
    for await (const evt of js.live({
      liveTransport: fakeTransport([syncFrame(1), deleteFrame(2)]),
    })) {
      kinds.push(evt.kind)
    }
    expect(kinds).toEqual(['sync', 'commit'])
  })

  it('sends the kinds filter', async () => {
    const t = fakeTransport([deleteFrame(1)])
    const js = new Jetstream('https://js.example')
    for await (const _ of js.live({ liveTransport: t, kinds: ['commit'] }))
      void _
    expect(t.urls[0]).toContain('kinds=commit')
  })

  it('converts typed records to lex data', async () => {
    const schema = record('tid', 'app.test.rec', l.object({ text: l.string() }))
    const js = new Jetstream('https://js.example')
    const texts: string[] = []
    for await (const evt of js.live({
      collections: [schema],
      liveTransport: fakeTransport([
        putFrame(1, { $type: 'app.test.rec', text: 'hi' }),
      ]),
    })) {
      if (evt.kind === 'commit' && evt.commit.operation !== 'delete') {
        texts.push(evt.commit.record.text)
      }
    }
    expect(texts).toEqual(['hi'])
  })

  it('uses a stored cursor as both wire cursor and dedup floor', async () => {
    const cursor = new MemoryCursorStore()
    await cursor.save(2)
    const t = fakeTransport([deleteFrame(2), deleteFrame(3)])
    const js = new Jetstream('https://js.example')
    const out: number[] = []
    for await (const evt of js.live({ cursor, liveTransport: t })) {
      out.push(evt.seq)
    }
    expect(t.urls[0]).toContain('cursor=2')
    expect(out).toEqual([3]) // the replayed seq 2 is deduped
  })

  it('yields raw events with raw: true', async () => {
    const js = new Jetstream('https://js.example')
    const out: unknown[] = []
    for await (const evt of js.live({
      raw: true,
      liveTransport: fakeTransport([
        putFrame(1, { $type: 'app.test.rec', text: 'x' }),
      ]),
    })) {
      out.push(evt)
    }
    expect(out).toHaveLength(1)
    // Raw records stay wire-faithful — no conversion on this path.
    expect(out[0]).toMatchObject({
      kind: 'commit',
      commit: { record: { $type: 'app.test.rec', text: 'x' } },
    })
  })

  it('skips schema-invalid records and reports RecordValidationError', async () => {
    const schema = record('tid', 'app.test.rec', l.object({ text: l.string() }))
    const js = new Jetstream('https://js.example')
    const errors: Error[] = []
    const seqs: number[] = []
    for await (const evt of js.live({
      collections: [schema],
      onError: (e) => errors.push(e),
      liveTransport: fakeTransport([
        putFrame(1, { $type: 'app.test.rec', text: 'ok' }),
        putFrame(2, { $type: 'app.test.rec', text: 123 }), // invalid
      ]),
    })) {
      seqs.push(evt.seq)
    }
    expect(seqs).toEqual([1])
    expect(errors).toHaveLength(1)
    expect(errors[0].name).toBe('RecordValidationError')
  })

  it('makes a malformed frame fatal under validateWire', async () => {
    const js = new Jetstream({
      service: 'https://js.example',
      validateWire: true,
    })
    const bad = JSON.stringify({
      $type: 'message',
      payload: {
        $type: `${NSID}#commit`,
        seq: 1,
        did: 'not-a-did',
        time: TIME,
        rev: TID,
        operation: 'delete',
        collection: 'app.test.rec',
        rkey: 'r1',
      },
    })
    await expect(async () => {
      for await (const _ of js.live({ liveTransport: fakeTransport([bad]) })) {
        void _
      }
    }).rejects.toThrow(/wire validation failed/)
  })
})
