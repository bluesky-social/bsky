import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { encode as cborEncode } from '@atproto/lex-cbor'
import { expect, test } from 'vitest'
import { Jetstream } from '../../src/jetstream.js'
import { SegKind } from '../../src/segment/kind.js'
import { RecordValidationError } from '../../src/shape.js'

// Golden block row 0 payload is CBOR {hello: 5} (A1 65 68 65 6C 6C 6F 05).
const goldenFrame = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../fixtures/golden_block.bin', import.meta.url)),
  ),
)
const fetchImpl = (async (url: string | URL) => {
  const u = String(url)
  if (u.includes('planSnapshot')) {
    return new Response(
      JSON.stringify({
        plannedThroughSeq: 3,
        sealedTipSeq: 3,
        segments: [
          {
            name: 'a.jss',
            index: 0,
            checksum: 'x'.repeat(16),
            minSeq: 1,
            maxSeq: 3,
            mode: 'blocks',
            blocks: [{ first: 0, last: 0 }],
          },
        ],
        stats: {
          segmentsExamined: 1,
          segmentsMatched: 1,
          blocksMatched: 1,
          entries: 1,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  if (u.includes('getBlock')) return new Response(goldenFrame, { status: 200 })
  throw new Error('unexpected')
}) as unknown as typeof fetch

test('backfill skips and reports a record that fails conversion', async () => {
  const js = new Jetstream({ service: 'https://js.example', fetchImpl })
  const errored: Error[] = []
  const events = []
  for await (const e of js.snapshot({ onError: (err) => errored.push(err) }))
    events.push(e)
  // The golden fixture's put payload ({hello: 5}) predates the record
  // contract (every real record has $type), so conversion fails; typed mode
  // skips the put and reports it — the identity and delete still flow.
  expect(events.map((e) => e.kind)).toEqual(['identity', 'commit'])
  expect(errored).toHaveLength(1)
  expect(errored[0]).toBeInstanceOf(RecordValidationError)
  expect(errored[0].message).toContain('app.bsky.feed.post')
})

// Hand-rolled block encoder, mirroring decodeBlock's exact binary layout
// (src/segment/block.ts): [u32le count], then fixed columns column-major
// (seq u64le, indexedAt i64le, renderedAt i64le, kind u8, collLen u8,
// didLen u16le, rkeyLen u8, revLen u8, payLen u32le), then variable columns
// column-major (collection, did, rkey, rev, payload bytes). getBlock's wire
// response is this buffer zstd-compressed. Building this locally (rather
// than reusing golden_block.bin, whose payload predates the $type record
// contract) lets this test assert a positive decoded-record outcome through
// the real segment-fetch -> rawEventFromSegment -> typedEventFromRaw wiring.
export function encodeBlock(
  rows: {
    seq: number
    indexedAt: number
    renderedAt: number
    kind: number
    did: string
    collection: string
    rkey: string
    rev: string
    payload: Uint8Array
  }[],
): Uint8Array {
  const enc = new TextEncoder()
  const cols = rows.map((r) => ({
    ...r,
    collB: enc.encode(r.collection),
    didB: enc.encode(r.did),
    rkeyB: enc.encode(r.rkey),
    revB: enc.encode(r.rev),
  }))
  const n = cols.length
  let size = 4 + n * (8 + 8 + 8 + 1 + 1 + 2 + 1 + 1 + 4)
  for (const c of cols) {
    size +=
      c.collB.length +
      c.didB.length +
      c.rkeyB.length +
      c.revB.length +
      c.payload.length
  }
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  let off = 0
  view.setUint32(off, n, true)
  off += 4
  for (const c of cols) {
    view.setBigUint64(off, BigInt(c.seq), true)
    off += 8
  }
  for (const c of cols) {
    view.setBigInt64(off, BigInt(c.indexedAt), true)
    off += 8
  }
  for (const c of cols) {
    view.setBigInt64(off, BigInt(c.renderedAt), true)
    off += 8
  }
  for (const c of cols) {
    buf[off] = c.kind
    off += 1
  }
  for (const c of cols) {
    buf[off] = c.collB.length
    off += 1
  }
  for (const c of cols) {
    view.setUint16(off, c.didB.length, true)
    off += 2
  }
  for (const c of cols) {
    buf[off] = c.rkeyB.length
    off += 1
  }
  for (const c of cols) {
    buf[off] = c.revB.length
    off += 1
  }
  for (const c of cols) {
    view.setUint32(off, c.payload.length, true)
    off += 4
  }
  for (const c of cols) {
    buf.set(c.collB, off)
    off += c.collB.length
  }
  for (const c of cols) {
    buf.set(c.didB, off)
    off += c.didB.length
  }
  for (const c of cols) {
    buf.set(c.rkeyB, off)
    off += c.rkeyB.length
  }
  for (const c of cols) {
    buf.set(c.revB, off)
    off += c.revB.length
  }
  for (const c of cols) {
    buf.set(c.payload, off)
    off += c.payload.length
  }
  return buf
}

test("backfill happy path: a $type'd record decodes end to end through segment-fetch -> rawEventFromSegment -> typedEventFromRaw", async () => {
  const record = { $type: 'app.bsky.feed.post', text: 'hello wire-faithful' }
  const payload = cborEncode(record)
  const block = encodeBlock([
    {
      seq: 1,
      indexedAt: 1000,
      renderedAt: 0,
      kind: SegKind.Create,
      did: 'did:plc:test',
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
      rev: '3jzfcijpj2z2a',
      payload,
    },
  ])
  const compressed = zstdCompressSync(block)

  const localFetchImpl = (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('planSnapshot')) {
      return new Response(
        JSON.stringify({
          plannedThroughSeq: 1,
          sealedTipSeq: 1,
          segments: [
            {
              name: 'synthetic.jss',
              index: 0,
              checksum: 'y'.repeat(16),
              minSeq: 1,
              maxSeq: 1,
              mode: 'blocks',
              blocks: [{ first: 0, last: 0 }],
            },
          ],
          stats: {
            segmentsExamined: 1,
            segmentsMatched: 1,
            blocksMatched: 1,
            entries: 1,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (u.includes('getBlock')) return new Response(compressed, { status: 200 })
    throw new Error('unexpected')
  }) as unknown as typeof fetch

  const js = new Jetstream({
    service: 'https://js.example',
    fetchImpl: localFetchImpl,
  })
  const events = []
  for await (const e of js.snapshot()) events.push(e)
  const post = events.find(
    (e) => e.kind === 'commit' && e.commit.operation === 'create',
  )!
  if (post.kind !== 'commit' || post.commit.operation === 'delete')
    throw new Error('unreachable')
  expect(post.commit.validationError).toBeUndefined()
  expect(post.commit.record).toEqual(record)
})
