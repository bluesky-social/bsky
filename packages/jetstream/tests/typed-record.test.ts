import { isCid, l, record } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import { typedEventFromRaw } from '../src/decode-typed.js'
import { type RawEvent } from '../src/event.js'
import { type RawRecordJson } from '../src/raw-record.js'

const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'

// RawEvent is the v2 envelope (EventBase carries `time`, not v1's `timeUs` —
// see event.ts's note on why the two envelopes are deliberately divergent).
const putEvent = (rec: RawRecordJson): RawEvent<RawRecordJson> => ({
  did: 'did:plc:a' as never,
  seq: 1,
  time: '2024-01-01T00:00:00.000Z' as never,
  kind: 'commit',
  commit: {
    operation: 'create',
    collection: 'app.test.rec' as never,
    rkey: 'r1' as never,
    rev: 'rev1' as never,
    cid: CID as never,
    record: rec,
  },
})

describe('typedEventFromRaw record conversion', () => {
  it('converts the record to lex data', () => {
    const t = typedEventFromRaw(
      putEvent({ $type: 'app.test.rec', img: { $link: CID } }),
      new Map(),
    )
    if (t.kind !== 'commit' || t.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    const rec = t.commit.record as unknown as { img: unknown }
    expect(isCid(rec.img)).toBe(true)
    expect(t.commit.validationError).toBeUndefined()
  })

  it('reports a conversion failure as validationError with no record', () => {
    const evil = JSON.parse('{"$type":"app.test.rec","__proto__":{"b":1}}')
    const t = typedEventFromRaw(putEvent(evil), new Map())
    if (t.kind !== 'commit' || t.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    expect(t.commit.record).toBeUndefined()
    expect(t.commit.validationError).toBeInstanceOf(Error)
  })

  it('adopts the schema-validated value so coercions survive', () => {
    const schema = record('tid', 'app.test.rec', l.object({ text: l.string() }))
    const schemas = new Map([['app.test.rec', schema]])
    const t = typedEventFromRaw(
      putEvent({ $type: 'app.test.rec', text: 'hi' }),
      schemas,
    )
    if (t.kind !== 'commit' || t.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    expect(t.commit.validationError).toBeUndefined()
    expect(t.commit.record).toMatchObject({ text: 'hi' })
  })

  it('does not schema-validate when conversion already failed', () => {
    const schema = record('tid', 'app.test.rec', l.object({ text: l.string() }))
    const schemas = new Map([['app.test.rec', schema]])
    const evil = JSON.parse('{"$type":"app.test.rec","__proto__":{"b":1}}')
    const t = typedEventFromRaw(putEvent(evil), schemas)
    if (t.kind !== 'commit' || t.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    // The conversion error is reported, not a downstream validation error.
    expect(t.commit.validationError?.message).toMatch(/parse raw record/)
  })

  it('strict mode tightens conversion', () => {
    const float = { $type: 'app.test.rec', n: 1.5 }
    expect(typedEventFromRaw(putEvent(float), new Map()).kind).toBe('commit')
    const strict = typedEventFromRaw(putEvent(float), new Map(), {
      strict: true,
    })
    if (strict.kind !== 'commit' || strict.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    expect(strict.commit.validationError).toBeInstanceOf(Error)
  })

  it('leaves cid readable and passes deletes through', () => {
    const t = typedEventFromRaw(
      putEvent({ $type: 'app.test.rec', text: 'hi' }),
      new Map(),
    )
    if (t.kind !== 'commit' || t.commit.operation === 'delete') {
      expect.unreachable('expected a put commit')
    }
    expect(t.commit.cid).toBe(CID)
  })
})
