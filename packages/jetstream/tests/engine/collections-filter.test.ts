import { l, record } from '@atproto/lex-schema'
import { describe, expect, it } from 'vitest'
import { resolveNsids } from '../../src/engine/collections.js'
import { RecordValidationError } from '../../src/shape.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

describe('resolveNsids options form', () => {
  it('options form resolves the NSID and registers the schema by default', () => {
    const { nsids, schemasByNsid } = resolveNsids([{ collection: likeSchema }])
    expect(nsids).toEqual(['app.test.like'])
    expect(schemasByNsid.has('app.test.like')).toBe(true)
  })

  it('validateRecord: false contributes the NSID but omits the schema', () => {
    const { nsids, schemasByNsid } = resolveNsids([
      { collection: likeSchema, validateRecord: false },
    ])
    expect(nsids).toEqual(['app.test.like'])
    expect(schemasByNsid.size).toBe(0)
  })

  it('mixed filter forms resolve together', () => {
    const { nsids, schemasByNsid } = resolveNsids([
      likeSchema,
      'app.test.post',
      { collection: likeSchema, validateRecord: false },
    ])
    expect(nsids).toEqual(['app.test.like', 'app.test.post', 'app.test.like'])
    // the bare-schema form registered it; the validateRecord: false form
    // must not UNregister it
    expect(schemasByNsid.has('app.test.like')).toBe(true)
  })
})

describe('RecordValidationError', () => {
  it('carries did/collection/rkey/seq and cause', () => {
    const cause = new Error('bad subject')
    const err = new RecordValidationError({
      did: 'did:plc:a',
      collection: 'app.test.like',
      rkey: 'rk1',
      seq: 42,
      cause,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RecordValidationError')
    expect(err.did).toBe('did:plc:a')
    expect(err.collection).toBe('app.test.like')
    expect(err.rkey).toBe('rk1')
    expect(err.seq).toBe(42)
    expect(err.cause).toBe(cause)
    expect(err.message).toContain('app.test.like')
    expect(err.message).toContain('42')
  })
})
