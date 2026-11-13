import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { rawEventFromSegment } from '../../src/decode-event.js'
import { typedEventFromRaw } from '../../src/decode-typed.js'
import { makeSelector } from '../../src/engine/selector.js'
import { MalformedError } from '../../src/errors.js'
import { scopedRecordKey } from '../../src/event.js'
import { SKIP_FRAME, decodeLiveFrame } from '../../src/live/decode.js'
import { defaultRuntime } from '../../src/runtime/node.js'
import { type SegEvent, decodeBlockFrame } from '../../src/segment/block.js'

const d = defaultRuntime.zstdDecompressor()
const sha256 = defaultRuntime.sha256()
const rows = decodeBlockFrame(
  new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL('../fixtures/spaces_block_v2.bin', import.meta.url),
      ),
    ),
  ),
  d,
  undefined,
  2,
)
const ALICE = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const BOB = 'did:plc:4qtfnvqsjsl2bc6ut7ezqzhb'
const convert = (r: SegEvent) =>
  rawEventFromSegment(r, { sha256, validateWire: true })

describe('archive rows become Spaces events', () => {
  const events = rows.map(convert)

  test('commits keep the author and carry space only when present', () => {
    const [pub, a, b] = events
    expect(pub).not.toHaveProperty('space')
    expect(a).toMatchObject({ kind: 'commit', space: 'space:a', did: ALICE })
    expect(b).toMatchObject({
      kind: 'commit',
      space: 'space:b',
      did: ALICE,
      commit: { operation: 'delete' },
    })
  })

  test('matching record paths in different spaces stay distinct', () => {
    const keys = events.slice(0, 3).map((e) => {
      if (e.kind !== 'commit') throw new Error('expected commit')
      return scopedRecordKey({ space: e.space, did: e.did, ...e.commit })
    })
    expect(new Set(keys).size).toBe(3)
  })

  test('a scoped sync resets only that space', () => {
    expect(events[3]).toMatchObject({
      kind: 'sync',
      space: 'space:a',
      did: ALICE,
      sync: { did: ALICE, rev: '3l3qo2vusxc2b' },
    })
  })

  test('repoRemoved carries its author; spaceDeleted has none', () => {
    expect(events[4]).toEqual({
      seq: 5,
      time: expect.any(String),
      space: 'space:b',
      did: BOB,
      kind: 'scope',
      scope: {
        operation: 'repoRemoved',
        did: BOB,
        cause: 'authorityNotification',
        lastKnownRev: '3l3qo2vutsw2b',
      },
    })
    expect(events[5]).toEqual({
      seq: 6,
      time: expect.any(String),
      space: 'space:c',
      kind: 'scope',
      scope: { operation: 'spaceDeleted' },
    })
    expect(events[5]).not.toHaveProperty('did')
  })

  test('account and identity stay global', () => {
    expect(events[6]).toMatchObject({ kind: 'account', did: ALICE })
    expect(events[7]).toMatchObject({ kind: 'identity', did: ALICE })
    expect(events[6]).not.toHaveProperty('space')
  })

  test('typed conversion preserves space and scope', () => {
    const typed = events.map((e) => typedEventFromRaw(e, new Map()))
    expect(typed[1]).toMatchObject({ space: 'space:a', kind: 'commit' })
    expect(typed[5]).toBe(events[5])
  })

  test('a global row carrying a space is malformed', () => {
    expect(() => convert({ ...rows[6], space: 'space:a' })).toThrow(
      /global account row carries a space/,
    )
  })

  test('scope rows are validated strictly', () => {
    const scope = rows[4]
    expect(() => convert({ ...scope, did: '' as SegEvent['did'] })).toThrow(
      /repoRemoved without did/,
    )
    expect(() => convert({ ...rows[5], did: BOB as SegEvent['did'] })).toThrow(
      /spaceDeleted with did/,
    )
    expect(() => convert({ ...scope, space: '' })).toThrow(/missing space/)
    expect(() =>
      convert({ ...scope, payload: new Uint8Array([0xa0]) }),
    ).toThrow(MalformedError)
  })
})

describe('the archive selector', () => {
  const keep = (opts: Parameters<typeof makeSelector>[0]) => {
    const s = makeSelector(opts)
    return rows.filter((r) => s.keep(r)).map((r) => r.seq)
  }

  test('a DID filter keeps the authorless spaceDeleted marker', () => {
    expect(keep({ dids: [BOB], collections: [] })).toEqual([5, 6, 9])
    // repoRemoved is narrowed by its author like any row.
    expect(keep({ dids: [ALICE], collections: [] })).toEqual([
      1, 2, 3, 4, 6, 7, 8,
    ])
  })

  test('a collection filter keeps every lifecycle event', () => {
    expect(keep({ collections: ['app.example.note'] })).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })
})

describe('live Spaces frames', () => {
  const NSID = 'network.bsky.jetstream.subscribeEvents'
  const frame = (payload: Record<string, unknown>) =>
    JSON.stringify({ $type: 'message', payload })
  const commit = {
    $type: `${NSID}#commit`,
    seq: 2,
    did: ALICE,
    space: 'space:a',
    time: '2026-10-31T12:00:00.002000Z',
    rev: '3l3qo2vuqbk2b',
    operation: 'delete',
    collection: 'app.example.note',
    rkey: '3l3qo2vutsw2b',
  }
  const spaces = { spaces: true }

  test('commit and sync carry space; public mode ignores it', () => {
    expect(decodeLiveFrame(frame(commit), true, spaces)).toMatchObject({
      space: 'space:a',
      did: ALICE,
    })
    expect(decodeLiveFrame(frame(commit), true)).not.toHaveProperty('space')
    expect(
      decodeLiveFrame(
        frame({
          $type: `${NSID}#sync`,
          seq: 4,
          did: ALICE,
          space: 'space:a',
          time: '2026-10-31T12:00:00.004000Z',
          sync: { did: ALICE, rev: '3l3qo2vusxc2b', blocks: { $bytes: '' } },
        }),
        true,
        spaces,
      ),
    ).toMatchObject({ kind: 'sync', space: 'space:a' })
  })

  test('both scope operations', () => {
    const repoRemoved = {
      $type: `${NSID}#scope`,
      seq: 5,
      time: '2026-10-31T12:00:00.005000Z',
      space: 'space:b',
      operation: 'repoRemoved',
      did: BOB,
      cause: 'authorityNotification',
      lastKnownRev: '3l3qo2vutsw2b',
    }
    expect(decodeLiveFrame(frame(repoRemoved), false, spaces)).toEqual({
      seq: 5,
      time: repoRemoved.time,
      space: 'space:b',
      did: BOB,
      kind: 'scope',
      scope: {
        operation: 'repoRemoved',
        did: BOB,
        cause: 'authorityNotification',
        lastKnownRev: '3l3qo2vutsw2b',
      },
    })
    const spaceDeleted = {
      $type: `${NSID}#scope`,
      seq: 6,
      time: '2026-10-31T12:00:00.006000Z',
      space: 'space:c',
      operation: 'spaceDeleted',
    }
    expect(decodeLiveFrame(frame(spaceDeleted), false, spaces)).toEqual({
      seq: 6,
      time: spaceDeleted.time,
      space: 'space:c',
      kind: 'scope',
      scope: { operation: 'spaceDeleted' },
    })
    expect(() =>
      decodeLiveFrame(frame({ ...spaceDeleted, did: BOB }), false, spaces),
    ).toThrow(/spaceDeleted scope with did/)
    expect(() =>
      decodeLiveFrame(frame({ ...repoRemoved, did: undefined }), false, spaces),
    ).toThrow(/repoRemoved scope without did/)
    // Public streams never surface it.
    expect(decodeLiveFrame(frame(repoRemoved), false)).toBe(SKIP_FRAME)
  })

  test('progress frames only when requested; zero is valid', () => {
    const progress = {
      $type: `${NSID}#progress`,
      throughSeq: 0,
      caughtUp: false,
    }
    expect(
      decodeLiveFrame(frame(progress), false, { spaces: true, progress: true }),
    ).toEqual({
      progress: { kind: 'progress', throughSeq: 0, caughtUp: false },
    })
    expect(decodeLiveFrame(frame(progress), false, spaces)).toBe(SKIP_FRAME)
    expect(decodeLiveFrame(frame(progress), false)).toBe(SKIP_FRAME)
    expect(() =>
      decodeLiveFrame(frame({ ...progress, throughSeq: -1 }), false, {
        spaces: true,
        progress: true,
      }),
    ).toThrow(/invalid progress frame/)
  })
})
