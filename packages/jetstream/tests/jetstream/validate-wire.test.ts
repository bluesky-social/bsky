import { describe, expect, it } from 'vitest'
import { MalformedError } from '../../src/errors.js'
import { type TypedEventV1 } from '../../src/event.js'
import { RecordValidationError } from '../../src/index.js'
import { Jetstream } from '../../src/jetstream.js'
import type { LiveTransport } from '../../src/live/transport.js'

const TID = '3jzfcijpj2z2a'
const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'

const frame = (did: string, time_us: number) =>
  JSON.stringify({
    did,
    time_us,
    kind: 'commit',
    commit: {
      operation: 'delete',
      collection: 'app.bsky.feed.like',
      rkey: TID,
      rev: TID,
    },
  })

const putFrame = (did: string, rec: unknown) =>
  JSON.stringify({
    did,
    time_us: 1,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.like',
      rkey: TID,
      rev: TID,
      cid: CID,
      record: rec,
    },
  })

function transportOf(frames: string[]): LiveTransport {
  return {
    async *stream() {
      for (const f of frames) yield new TextEncoder().encode(f)
    },
  }
}

describe('validateWire strict mode', () => {
  it('live: throws MalformedError on a mangled did (raw mode, fatal)', async () => {
    const js = new Jetstream({
      service: 'https://js.example',
      validateWire: true,
    })
    const consume = async () => {
      for await (const _ of js.live({
        raw: true,
        liveTransport: transportOf([frame('not-a-did', 1)]),
      })) {
        // unreachable
      }
    }
    await expect(consume()).rejects.toThrow(MalformedError)
  })

  it('live: accepts well-formed frames and yields them', async () => {
    const js = new Jetstream({
      service: 'https://js.example',
      validateWire: true,
    })
    const seqs: number[] = []
    for await (const ev of js.live({
      raw: true,
      liveTransport: transportOf([
        frame('did:plc:a', 1),
        frame('did:plc:a', 2),
      ]),
    })) {
      seqs.push(ev.seq)
    }
    expect(seqs).toEqual([1, 2])
  })

  it('default mode: the same mangled frame passes through untouched', async () => {
    const js = new Jetstream({ service: 'https://js.example' })
    const dids: string[] = []
    for await (const ev of js.live({
      raw: true,
      liveTransport: transportOf([frame('not-a-did', 1)]),
    })) {
      dids.push(ev.did)
    }
    expect(dids).toEqual(['not-a-did']) // optimistic: brand means "server said so"
  })

  it('strict mode throws on a missing required field (commit without rev)', async () => {
    const js = new Jetstream({
      service: 'https://js.example',
      validateWire: true,
    })
    const noRev = JSON.stringify({
      did: 'did:plc:a',
      time_us: 1,
      kind: 'commit',
      commit: {
        operation: 'delete',
        collection: 'app.bsky.feed.like',
        rkey: TID,
      },
    })
    const consume = async () => {
      for await (const _ of js.live({
        raw: true,
        liveTransport: transportOf([noRev]),
      })) {
        // unreachable
      }
    }
    await expect(consume()).rejects.toThrow(MalformedError)
  })

  it('unknown kinds still SKIP_FRAME in strict mode (pre-discrimination)', async () => {
    const js = new Jetstream({
      service: 'https://js.example',
      validateWire: true,
    })
    const seqs: number[] = []
    for await (const ev of js.live({
      raw: true,
      liveTransport: transportOf([
        JSON.stringify({ did: 'did:plc:a', time_us: 1, kind: 'wat' }),
        frame('did:plc:a', 2),
      ]),
    })) {
      seqs.push(ev.seq)
    }
    expect(seqs).toEqual([2])
  })

  it('typed mode: strict tightens record conversion; default mode does not', async () => {
    // 1.5 is a non-integer number: strict conversion (matching validateWire)
    // rejects it, loose conversion accepts it as-is.
    const float = { $type: 'app.bsky.feed.like', n: 1.5 }

    const strictErrors: Error[] = []
    const strictJs = new Jetstream({
      service: 'https://js.example',
      validateWire: true,
    })
    const strictOut: unknown[] = []
    for await (const ev of strictJs.live({
      liveTransport: transportOf([putFrame('did:plc:a', float)]),
      onError: (err) => strictErrors.push(err),
    })) {
      strictOut.push(ev)
    }
    // The conversion failure is skipped and reported, never delivered — this
    // also exercises the fix for skipInvalid() reporting conversion failures
    // regardless of whether the collection has a registered schema.
    expect(strictOut).toHaveLength(0)
    expect(strictErrors).toHaveLength(1)
    expect(strictErrors[0]).toBeInstanceOf(RecordValidationError)

    const defaultJs = new Jetstream({ service: 'https://js.example' })
    const defaultOut: TypedEventV1[] = []
    for await (const ev of defaultJs.live({
      liveTransport: transportOf([putFrame('did:plc:a', float)]),
      onError: () => {
        throw new Error('default mode must not report a conversion error')
      },
    })) {
      defaultOut.push(ev)
    }
    expect(defaultOut).toHaveLength(1)
    const defaultEv = defaultOut[0]
    if (
      defaultEv.kind !== 'commit' ||
      defaultEv.commit.operation === 'delete'
    ) {
      throw new Error('expected a put commit')
    }
    expect(defaultEv.commit.validationError).toBeUndefined()
  })
})
