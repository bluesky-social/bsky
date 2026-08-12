import { describe, expect, it } from 'vitest'
import { MalformedError, XrpcSubscriptionError } from '../../src/errors.js'
import { SKIP_FRAME, decodeLiveFrame } from '../../src/live/decode.js'

const NSID = 'network.bsky.jetstream.subscribeEvents'
const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'
const TIME = '2024-09-09T19:46:02.329308Z'
// A well-formed TID (13-char base32-sortable) — required so strict-mode
// tests that are NOT about `rev` don't spuriously fail on it, and so the
// positive strict-mode test actually exercises acceptance of valid wire.
const TID = '3jzfcijpj2z2a'

const msg = (payload: unknown): string =>
  JSON.stringify({ $type: 'message', payload })

const commit = (over: Record<string, unknown> = {}): string =>
  msg({
    $type: `${NSID}#commit`,
    seq: 7,
    did: 'did:plc:a',
    time: TIME,
    rev: TID,
    operation: 'create',
    collection: 'app.bsky.feed.post',
    rkey: 'r1',
    cid: CID,
    record: { $type: 'app.bsky.feed.post', text: 'hi' },
    ...over,
  })

describe('decodeLiveFrame commits', () => {
  it('maps a flat payload onto a nested commit', () => {
    const ev = decodeLiveFrame(commit())
    expect(ev).toEqual({
      did: 'did:plc:a',
      seq: 7,
      time: TIME,
      kind: 'commit',
      commit: {
        operation: 'create',
        collection: 'app.bsky.feed.post',
        rkey: 'r1',
        rev: TID,
        cid: CID,
        record: { $type: 'app.bsky.feed.post', text: 'hi' },
      },
    })
  })

  it('keeps the record wire-faithful', () => {
    const ev = decodeLiveFrame(
      commit({ record: { $type: 'app.test.rec', img: { $link: CID } } }),
    )
    if (ev === SKIP_FRAME || 'info' in ev) expect.unreachable('expected commit')
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    // Not converted here — the typed layer owns conversion.
    expect(ev.commit.record).toEqual({
      $type: 'app.test.rec',
      img: { $link: CID },
    })
  })

  it('uses the wire cid verbatim and ignores a stray recordCbor', () => {
    const ev = decodeLiveFrame(commit({ recordCbor: 'AAAA' }))
    if (ev === SKIP_FRAME || 'info' in ev) expect.unreachable('expected commit')
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    expect(ev.commit.cid).toBe(CID)
    expect('recordCbor' in ev.commit).toBe(false)
  })

  it('decodes a delete with no record or cid', () => {
    const ev = decodeLiveFrame(
      commit({ operation: 'delete', record: undefined, cid: undefined }),
    )
    if (ev === SKIP_FRAME || 'info' in ev) expect.unreachable('expected commit')
    expect(ev.kind === 'commit' && ev.commit).toEqual({
      operation: 'delete',
      collection: 'app.bsky.feed.post',
      rkey: 'r1',
      rev: TID,
    })
  })

  it('throws when a put is missing record or cid', () => {
    expect(() => decodeLiveFrame(commit({ record: undefined }))).toThrow(
      MalformedError,
    )
    expect(() => decodeLiveFrame(commit({ cid: undefined }))).toThrow(
      MalformedError,
    )
  })

  it('throws on an unknown operation', () => {
    expect(() => decodeLiveFrame(commit({ operation: 'merge' }))).toThrow(
      MalformedError,
    )
  })
})

describe('decodeLiveFrame non-commit kinds', () => {
  it('unwraps identity, letting the envelope seq/time win', () => {
    // The nested identity.time deliberately differs from the envelope TIME
    // so this test can tell "envelope wins" from "nested value leaked
    // through" — using the same value for both would let a decoder bug that
    // reads identity.time for the envelope's `time` pass unnoticed.
    const NESTED_TIME = '2020-01-01T00:00:00.000Z'
    const ev = decodeLiveFrame(
      msg({
        $type: `${NSID}#identity`,
        seq: 7,
        did: 'did:plc:a',
        time: TIME,
        identity: {
          seq: 999,
          did: 'did:plc:a',
          handle: 'a.test',
          time: NESTED_TIME,
        },
      }),
    )
    expect(ev).toEqual({
      did: 'did:plc:a',
      seq: 7,
      time: TIME,
      kind: 'identity',
      identity: { did: 'did:plc:a', handle: 'a.test', time: NESTED_TIME },
    })
  })

  it('unwraps account', () => {
    const ev = decodeLiveFrame(
      msg({
        $type: `${NSID}#account`,
        seq: 8,
        did: 'did:plc:a',
        time: TIME,
        account: { seq: 999, did: 'did:plc:a', active: true },
      }),
    )
    expect(ev).toEqual({
      did: 'did:plc:a',
      seq: 8,
      time: TIME,
      kind: 'account',
      account: {
        did: 'did:plc:a',
        active: true,
        status: undefined,
        time: undefined,
      },
    })
  })

  it('throws when account is missing the required active field, in every mode', () => {
    // active is the takedown/deactivation signal on subscribeRepos#account.
    // A missing value must never default to false ("deactivated") — it must
    // throw, in both default and strict mode.
    const bad = () =>
      msg({
        $type: `${NSID}#account`,
        seq: 8,
        did: 'did:plc:a',
        time: TIME,
        account: { did: 'did:plc:a' },
      })
    expect(() => decodeLiveFrame(bad())).toThrow(MalformedError)
    expect(() => decodeLiveFrame(bad(), true)).toThrow(MalformedError)
  })

  it('unwraps sync and discards blocks', () => {
    const ev = decodeLiveFrame(
      msg({
        $type: `${NSID}#sync`,
        seq: 9,
        did: 'did:plc:a',
        time: TIME,
        sync: {
          seq: 999,
          did: 'did:plc:a',
          rev: TID,
          blocks: { $bytes: 'AA' },
        },
      }),
    )
    expect(ev).toEqual({
      did: 'did:plc:a',
      seq: 9,
      time: TIME,
      kind: 'sync',
      sync: { did: 'did:plc:a', rev: TID, time: undefined },
    })
  })
})

describe('decodeLiveFrame control frames', () => {
  it('returns an info variant for #info, which carries no seq', () => {
    const ev = decodeLiveFrame(
      msg({
        $type: `${NSID}#info`,
        name: 'OutdatedCursor',
        message: 'clamped',
      }),
    )
    expect(ev).toEqual({ info: { name: 'OutdatedCursor', message: 'clamped' } })
  })

  it('accepts #info without a message and with an unknown name', () => {
    expect(
      decodeLiveFrame(msg({ $type: `${NSID}#info`, name: 'Whatever' })),
    ).toEqual({ info: { name: 'Whatever', message: undefined } })
  })

  it('throws XrpcSubscriptionError on a terminal error frame', () => {
    const frame = JSON.stringify({
      $type: 'error',
      error: 'ConsumerTooSlow',
      message: 'too slow',
    })
    try {
      decodeLiveFrame(frame)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(XrpcSubscriptionError)
      expect((err as XrpcSubscriptionError).error).toBe('ConsumerTooSlow')
      expect((err as Error).message).toBe('too slow')
    }
  })

  it('skips unknown payload types and non-message envelopes', () => {
    expect(decodeLiveFrame(msg({ $type: `${NSID}#future`, seq: 1 }))).toBe(
      SKIP_FRAME,
    )
    expect(decodeLiveFrame(JSON.stringify({ $type: 'hello' }))).toBe(SKIP_FRAME)
    expect(decodeLiveFrame(JSON.stringify({ kind: 'commit' }))).toBe(SKIP_FRAME)
  })

  it('throws MalformedError (not TypeError) on a null frame', () => {
    // `null` is valid JSON but not an object: without an explicit guard,
    // reading `.{$type}` off it throws TypeError, and strict-mode callers
    // (source.ts rethrows) would see the wrong error type.
    expect(() => decodeLiveFrame('null')).toThrow(MalformedError)
  })
})

describe('decodeLiveFrame always-on checks', () => {
  it('rejects a non-positive or unsafe seq in every mode', () => {
    for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => decodeLiveFrame(commit({ seq }))).toThrow(MalformedError)
      expect(() => decodeLiveFrame(commit({ seq }), true)).toThrow(
        MalformedError,
      )
    }
  })

  it('passes a malformed time through in default mode and rejects it in strict', () => {
    // No parsing: `time` is optimistically cast like any other branded string.
    const ev = decodeLiveFrame(commit({ time: 'nope' }))
    if (ev === SKIP_FRAME || 'info' in ev) expect.unreachable('expected commit')
    expect(ev.time).toBe('nope')
    expect(() => decodeLiveFrame(commit({ time: 'nope' }), true)).toThrow(
      MalformedError,
    )
  })

  it('reports malformed JSON with the SyntaxError as cause', () => {
    try {
      decodeLiveFrame('{not json')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      expect((err as MalformedError).cause).toBeInstanceOf(SyntaxError)
    }
  })

  it('accepts both string and Uint8Array frames', () => {
    const bytes = new TextEncoder().encode(commit())
    expect(decodeLiveFrame(bytes)).toEqual(decodeLiveFrame(commit()))
  })
})

describe('decodeLiveFrame validateWire', () => {
  it('accepts a well-formed commit in strict mode', () => {
    // Positive control for the negative tests below: without this, a wire
    // schema that rejects every real frame (e.g. a bogus required field)
    // would leave the whole suite green.
    expect(() => decodeLiveFrame(commit(), true)).not.toThrow()
  })

  it('accepts a record with blob $link/$bytes values in strict mode, wire-faithful', () => {
    const ev = decodeLiveFrame(
      commit({
        record: {
          $type: 'app.test.rec',
          img: { $link: CID },
          sig: { $bytes: 'AA==' },
        },
      }),
      true,
    )
    if (ev === SKIP_FRAME || 'info' in ev) expect.unreachable('expected commit')
    if (ev.kind !== 'commit' || ev.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    expect(ev.commit.record).toEqual({
      $type: 'app.test.rec',
      img: { $link: CID },
      sig: { $bytes: 'AA==' },
    })
  })

  it('throws on a schema violation only in strict mode', () => {
    const bad = commit({ collection: 'NOT AN NSID' })
    expect(() => decodeLiveFrame(bad)).not.toThrow()
    expect(() => decodeLiveFrame(bad, true)).toThrow(MalformedError)
  })

  it('rejects a missing required field in strict mode', () => {
    const bad = commit({ rev: undefined })
    expect(() => decodeLiveFrame(bad, true)).toThrow(MalformedError)
  })

  it('still accepts #info in strict mode', () => {
    expect(
      decodeLiveFrame(
        msg({ $type: `${NSID}#info`, name: 'OutdatedCursor' }),
        true,
      ),
    ).toEqual({ info: { name: 'OutdatedCursor', message: undefined } })
  })
})
