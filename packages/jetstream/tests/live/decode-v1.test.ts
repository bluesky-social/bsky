import { describe, expect, it, test } from 'vitest'
import { MalformedError } from '../../src/errors.js'
import { decodeLiveFrameV1 } from '../../src/live/decode-v1.js'
import { SKIP_FRAME } from '../../src/live/decode.js'

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
// string-first encoder for pre-serialized fixtures
const encStr = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('decodeLiveFrameV1', () => {
  it('decodes a long-form commit create (deployed spelling)', () => {
    const ev = decodeLiveFrameV1(
      enc({
        did: 'did:plc:abc',
        time_us: 1725911162329308,
        kind: 'commit',
        commit: {
          rev: '3l3qo2vutsw2b',
          operation: 'create',
          collection: 'app.bsky.feed.like',
          rkey: '3l3qo2vuowo2b',
          record: { $type: 'app.bsky.feed.like', subject: { uri: 'at://x' } },
          cid: 'bafyreidc6sydkkbchcyg62v77wbhzvb2mvytlmsychqgwf2xdjyflo3kiq',
        },
      }),
    )
    if (ev === SKIP_FRAME) throw new Error('skipped')
    expect(ev.kind).toBe('commit')
    expect(ev.seq).toBe(1725911162329308)
    expect(ev.timeUs).toBe(1725911162329308)
    expect(ev.did).toBe('did:plc:abc')
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete')
      throw new Error()
    expect(ev.commit.collection).toBe('app.bsky.feed.like')
    expect(ev.commit.cid).toMatch(/^bafyrei/)
    expect(ev.commit.record).toEqual({
      $type: 'app.bsky.feed.like',
      subject: { uri: 'at://x' },
    })
  })

  it('decodes a commit delete', () => {
    const ev = decodeLiveFrameV1(
      enc({
        did: 'did:plc:abc',
        time_us: 100,
        kind: 'commit',
        commit: {
          rev: 'r',
          operation: 'delete',
          collection: 'app.bsky.feed.post',
          rkey: 'rk',
        },
      }),
    )
    if (ev === SKIP_FRAME) throw new Error('skipped')
    if (ev.kind !== 'commit') throw new Error()
    expect(ev.commit.operation).toBe('delete')
    expect(ev.commit.collection).toBe('app.bsky.feed.post')
    expect(ev.seq).toBe(100)
  })

  it('decodes commit update', () => {
    const ev = decodeLiveFrameV1(
      enc({
        did: 'd',
        time_us: 1,
        kind: 'commit',
        commit: {
          rev: 'r',
          operation: 'update',
          collection: 'c.o.l',
          rkey: 'rk',
          record: { $type: 'c.o.l' },
          cid: 'cid1',
        },
      }),
    )
    if (
      ev === SKIP_FRAME ||
      ev.kind !== 'commit' ||
      ev.commit.operation === 'delete'
    )
      throw new Error()
    expect(ev.commit.operation).toBe('update')
  })

  it('decodes identity and account', () => {
    const id = decodeLiveFrameV1(
      enc({
        did: 'd',
        time_us: 2,
        kind: 'identity',
        identity: { did: 'd', handle: 'h.example' },
      }),
    )
    if (id === SKIP_FRAME) throw new Error()
    expect(id.kind).toBe('identity')
    const acc = decodeLiveFrameV1(
      enc({
        did: 'd',
        time_us: 3,
        kind: 'account',
        account: { did: 'd', active: true },
      }),
    )
    if (acc === SKIP_FRAME) throw new Error()
    if (acc.kind !== 'account') throw new Error()
    expect(acc.account.active).toBe(true)
  })

  it('skips unknown kinds (incl. prototype short codes); throws on error frames and non-JSON', () => {
    expect(decodeLiveFrameV1(enc({ did: 'd', time_us: 4, kind: 'wat' }))).toBe(
      SKIP_FRAME,
    )
    // prototype-era short codes are NOT deployed and NOT supported -> skip
    expect(
      decodeLiveFrameV1(
        enc({
          did: 'd',
          time_us: 5,
          type: 'com',
          commit: { rev: 'r', type: 'c' },
        }),
      ),
    ).toBe(SKIP_FRAME)
    expect(() =>
      decodeLiveFrameV1(enc({ error: 'boom', message: 'm' })),
    ).toThrow(MalformedError)
    expect(() =>
      decodeLiveFrameV1(new TextEncoder().encode('not json')),
    ).toThrow(MalformedError)
  })

  it('put commit missing record or cid throws MalformedError', () => {
    expect(() =>
      decodeLiveFrameV1(
        enc({
          did: 'd',
          time_us: 5,
          kind: 'commit',
          commit: {
            rev: 'r',
            operation: 'create',
            collection: 'c',
            rkey: 'rk',
          },
        }),
      ),
    ).toThrow(MalformedError)
  })
})

// --- validateWire strict mode tests (v1) ---

const TID = '3jzfcijpj2z2a'
const DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'

const v1Put = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    did: DID,
    time_us: 9,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.like',
      rkey: TID,
      rev: TID,
      cid: CID,
      record: { $type: 'app.bsky.feed.like' },
      ...over,
    },
  })

test('validateWire accepts a well-formed v1 put', () => {
  expect(decodeLiveFrameV1(encStr(v1Put()), true)).not.toBe(SKIP_FRAME)
})

test('validateWire checks the v1 wire cid format', () => {
  expect(() =>
    decodeLiveFrameV1(encStr(v1Put({ cid: 'garbage' })), true),
  ).toThrow(MalformedError)
})

test('validateWire throws on missing required time_us (the v1 cursor)', () => {
  const frame = JSON.parse(v1Put()) as Record<string, unknown>
  delete frame.time_us
  expect(() => decodeLiveFrameV1(encStr(JSON.stringify(frame)), true)).toThrow(
    MalformedError,
  )
})

test('default mode passes a mangled v1 did through untouched', () => {
  const ev = decodeLiveFrameV1(encStr(v1Put()), undefined)
  expect(ev).not.toBe(SKIP_FRAME)
  const bad = decodeLiveFrameV1(encStr(v1Put().replace(DID, 'not-a-did')))
  expect(bad).not.toBe(SKIP_FRAME)
})

test('unknown v1 commit operation throws MalformedError in default mode', () => {
  // Pins existing behavior: dispatch check throws before any record access.
  const frame = JSON.stringify({
    did: DID,
    time_us: 9,
    kind: 'commit',
    commit: {
      operation: 'frobnicate',
      collection: 'app.bsky.feed.like',
      rkey: TID,
      rev: TID,
    },
  })
  expect(() => decodeLiveFrameV1(encStr(frame))).toThrow(MalformedError)
})
