import { describe, expect, test } from 'vitest'
import { ProtocolError } from '../../src/errors.js'
import { Jetstream } from '../../src/jetstream.js'
import { getSegment } from '../../src/xrpc/download.js'
import { negotiateSpacesProtocol } from '../../src/xrpc/protocol.js'
import {
  CAPABILITIES,
  type FakeArchiveOpts,
  fakeArchive,
} from './fake-archive.js'

const service = 'https://archive.example'
const noRetry = { maxAttempts: 1 }

const spaces = (archive: ReturnType<typeof fakeArchive>, retry = noRetry) =>
  new Jetstream({ service, mode: 'spaces', fetchImpl: archive.fetch, retry })

async function snapshot(
  opts: FakeArchiveOpts,
  snapOpts: {
    progress?: true
    retry?: { maxAttempts: number; baseDelayMs?: number }
  } = {},
) {
  const archive = fakeArchive(opts)
  const seqs: number[] = []
  const progress: unknown[] = []
  const js = spaces(archive, snapOpts.retry)
  if (snapOpts.progress) {
    for await (const ev of js.snapshot({ raw: true, progress: true })) {
      if (ev.kind === 'progress') progress.push(ev)
      else seqs.push(ev.seq)
    }
  } else {
    for await (const ev of js.snapshot({ raw: true })) seqs.push(ev.seq)
  }
  return { archive, seqs, progress }
}
const methods = (a: ReturnType<typeof fakeArchive>) =>
  a.requests.map((r) => r.url.pathname.split('.').at(-1))

describe('capability discovery', () => {
  const negotiate = (capabilities: unknown, kinds?: string[]) =>
    negotiateSpacesProtocol({
      host: service,
      fetchImpl: fakeArchive({ capabilities }).fetch,
      kinds: kinds as never,
    })

  test('selects protocol 2 and the advertised formats', async () => {
    const p = await negotiate(CAPABILITIES)
    expect(p.protocolVersion).toBe(2)
    expect([...p.formats]).toEqual([1, 2])
  })

  test('a server without getCapabilities is a protocol error', async () => {
    const err = await negotiate(
      new Response('404 page not found', { status: 404 }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProtocolError)
    expect(String(err)).toMatch(/getCapabilities\) failed/)
  })

  test('never downgrades', async () => {
    await expect(
      negotiate({
        ...CAPABILITIES,
        protocolVersions: [1],
        requiredProtocolVersion: 1,
      }),
    ).rejects.toThrow(/does not offer Spaces protocolVersion=2/)
    await expect(
      negotiate({
        ...CAPABILITIES,
        protocolVersions: [1, 2, 3],
        requiredProtocolVersion: 3,
      }),
    ).rejects.toThrow(/requiredProtocolVersion=3/)
  })

  test('protocol 2 must advertise scope and every requested kind', async () => {
    await expect(
      negotiate({
        ...CAPABILITIES,
        eventKinds: ['commit', 'identity', 'account', 'sync'],
      }),
    ).rejects.toThrow(/missing scope/)
    await expect(
      negotiate({ ...CAPABILITIES, eventKinds: ['commit', 'scope'] }, ['sync']),
    ).rejects.toThrow(/selected event kind "sync"/)
  })
})

describe('Spaces snapshot against a strict archive', () => {
  test('whole-segment mode sends protocolVersion everywhere and decodes all rows', async () => {
    const { archive, seqs } = await snapshot({})
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(methods(archive)).toEqual([
      'getCapabilities',
      'planSnapshot',
      'getSegment',
    ])
    expect([...archive.requests[0].url.searchParams]).toEqual([])
    expect(archive.requests[1].body).toMatchObject({ protocolVersion: 2 })
    expect(archive.requests[2].url.searchParams.get('protocolVersion')).toBe(
      '2',
    )
  })

  test('blocks mode', async () => {
    const { archive, seqs } = await snapshot({ mode: 'blocks' })
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const blocks = archive.requests.filter((r) =>
      r.url.pathname.endsWith('getBlock'),
    )
    expect(blocks).toHaveLength(3)
    for (const b of blocks)
      expect(b.url.searchParams.get('protocolVersion')).toBe('2')
  })

  test('progress certifies the planned page only after its rows', async () => {
    const { seqs, progress } = await snapshot({}, { progress: true })
    expect(seqs).toHaveLength(9)
    expect(progress).toEqual([
      { kind: 'progress', throughSeq: 9, caughtUp: false },
    ])
  })

  test('an empty archive still reports zero coverage', async () => {
    const { seqs, progress } = await snapshot(
      { sealedTip: 0 },
      { progress: true },
    )
    expect(seqs).toEqual([])
    expect(progress).toEqual([
      { kind: 'progress', throughSeq: 0, caughtUp: false },
    ])
  })

  test('a re-plan after a failed download reuses the negotiated protocol', async () => {
    const archive = fakeArchive({ mode: 'blocks', failBlocks: 1 })
    const js = new Jetstream({
      service,
      mode: 'spaces',
      fetchImpl: archive.fetch,
      retry: noRetry,
      blockConcurrency: 1,
    })
    const seqs: number[] = []
    for await (const ev of js.snapshot({ raw: true, onError: () => {} }))
      seqs.push(ev.seq)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const m = methods(archive)
    expect(m.filter((x) => x === 'getCapabilities')).toHaveLength(1)
    expect(m.filter((x) => x === 'planSnapshot')).toHaveLength(2)
    for (const r of archive.requests.filter((x) => x.body)) {
      expect(r.body?.protocolVersion).toBe(2)
    }
  })

  test('a resumed segment download re-checks the negotiated headers', async () => {
    const retry = { maxAttempts: 3, baseDelayMs: 1 }
    const ok = await snapshot({ breakSegmentAfter: 200 }, { retry })
    expect(ok.seqs).toHaveLength(9)
    const ranged = ok.archive.requests.filter((r) => r.headers.get('range'))
    expect(ranged).toHaveLength(1)
    expect(ranged[0].url.searchParams.get('protocolVersion')).toBe('2')

    const bad = snapshot(
      {
        breakSegmentAfter: 200,
        resumeHeaders: { 'jetstream-format-version': '1' },
      },
      { retry },
    )
    await expect(bad).rejects.toThrow(ProtocolError)
  })
})

describe('header disagreement is terminal, never retried or re-planned', () => {
  const cases: Array<[string, FakeArchiveOpts, RegExp]> = [
    [
      'plan without protocol header',
      { protocolHeader: null },
      /planSnapshot.*Jetstream-Protocol-Version/,
    ],
    [
      'artifact with the wrong protocol',
      { protocolHeader: '1' },
      /Jetstream-Protocol-Version/,
    ],
    [
      'artifact format differs from plan',
      { formatHeader: '1' },
      /formatVersion header 1 does not match plan 2/,
    ],
    [
      'artifact without format header',
      { formatHeader: null },
      /Jetstream-Format-Version/,
    ],
    [
      'plan entry format not negotiated',
      { planFormatVersion: 3 },
      /unsupported formatVersion 3/,
    ],
  ]
  for (const [name, opts, message] of cases) {
    test(name, async () => {
      const archive = fakeArchive(opts)
      const js = new Jetstream({
        service,
        mode: 'spaces',
        fetchImpl: archive.fetch,
      })
      const run = async () => {
        for await (const _ of js.snapshot({ raw: true, onError: () => {} }))
          void _
      }
      await expect(run()).rejects.toSatisfy(
        (e: unknown) => e instanceof ProtocolError && message.test(e.message),
      )
      const m = methods(archive)
      expect(m.filter((x) => x === 'planSnapshot')).toHaveLength(1)
      expect(m.filter((x) => x === 'getSegment').length).toBeLessThanOrEqual(1)
    })
  }

  test('a plan entry without formatVersion is format 1 and must match', async () => {
    await expect(snapshot({ planFormatVersion: null })).rejects.toThrow(
      /formatVersion header 2 does not match plan 1/,
    )
  })

  test('buffered getSegment checks headers too', async () => {
    const protocol = await negotiateSpacesProtocol({
      host: service,
      fetchImpl: fakeArchive().fetch,
    })
    const good = fakeArchive()
    const bytes = await getSegment(
      service,
      'seg_0000000000.jss',
      good.fetch,
      undefined,
      noRetry,
      {
        protocol,
        format: 2,
      },
    )
    expect(bytes.length).toBeGreaterThan(0)
    expect(good.requests[0].url.searchParams.get('protocolVersion')).toBe('2')
    const bad = fakeArchive({ formatHeader: '1' })
    await expect(
      getSegment(
        service,
        'seg_0000000000.jss',
        bad.fetch,
        undefined,
        undefined,
        {
          protocol,
          format: 2,
        },
      ),
    ).rejects.toThrow(ProtocolError)
    expect(bad.requests).toHaveLength(1)
  })
})

describe('public mode is unchanged', () => {
  test('no discovery and no protocolVersion on any request', async () => {
    const archive = fakeArchive({ planFormatVersion: null })
    const js = new Jetstream({
      service,
      fetchImpl: archive.fetch,
      retry: noRetry,
    })
    // The strict Spaces archive rejects the public request shape.
    await expect(async () => {
      for await (const _ of js.snapshot({ raw: true })) void _
    }).rejects.toThrow(/requires protocolVersion=2/)
    expect(methods(archive)).toEqual(['planSnapshot'])
    expect(archive.requests[0].body).not.toHaveProperty('protocolVersion')
  })

  test('the scope kind is rejected locally', async () => {
    const archive = fakeArchive()
    const js = new Jetstream({ service, fetchImpl: archive.fetch })
    await expect(async () => {
      for await (const _ of js.snapshot({
        raw: true,
        kinds: ['scope' as never],
      }))
        void _
    }).rejects.toThrow(/scope/)
    expect(archive.requests).toEqual([])
  })
})
