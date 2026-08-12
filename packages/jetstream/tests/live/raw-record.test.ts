import { isCid } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import { MalformedError } from '../../src/errors.js'
import { parseRawRecord } from '../../src/raw-record.js'

const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'

describe('parseRawRecord', () => {
  it('converts $link to a Cid and $bytes to a Uint8Array', () => {
    const out = parseRawRecord({
      $type: 'app.test.rec',
      img: { $link: CID },
      blob: { $bytes: 'aGVsbG8=' },
    })
    expect(isCid(out.img)).toBe(true)
    expect(out.blob).toBeInstanceOf(Uint8Array)
  })

  it('passes a plain record through unchanged', () => {
    const out = parseRawRecord({ $type: 'app.test.rec', text: 'hi', n: 3 })
    expect(out).toEqual({ $type: 'app.test.rec', text: 'hi', n: 3 })
  })

  it("rejects records that are not $type'd objects", () => {
    expect(() => parseRawRecord([1, 2])).toThrow(MalformedError)
    expect(() => parseRawRecord(null)).toThrow(MalformedError)
    expect(() => parseRawRecord('nope')).toThrow(MalformedError)
    expect(() => parseRawRecord({ text: 'no $type' })).toThrow(MalformedError)
    expect(() => parseRawRecord({ $type: '' })).toThrow(MalformedError)
  })

  it('rejects a __proto__ key in either mode', () => {
    const evil = JSON.parse('{"$type":"app.test.rec","__proto__":{"bad":1}}')
    expect(() => parseRawRecord(evil)).toThrow(MalformedError)
    const nested = JSON.parse(
      '{"$type":"app.test.rec","a":{"__proto__":{"b":1}}}',
    )
    expect(() => parseRawRecord(nested)).toThrow(MalformedError)
  })

  it('strict mode rejects non-integer numbers and malformed $link', () => {
    const float = { $type: 'app.test.rec', n: 1.5 }
    expect(parseRawRecord(float)).toEqual(float) // allowed by default
    expect(() => parseRawRecord(float, { strict: true })).toThrow(
      MalformedError,
    )
    const badLink = { $type: 'app.test.rec', c: { $link: 5 } }
    expect(() => parseRawRecord(badLink, { strict: true })).toThrow(
      MalformedError,
    )
  })

  it('wraps the underlying failure as the error cause', () => {
    try {
      parseRawRecord({ $type: 'app.test.rec', n: 1.5 }, { strict: true })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      expect((err as MalformedError).cause).toBeInstanceOf(Error)
    }
  })
})
