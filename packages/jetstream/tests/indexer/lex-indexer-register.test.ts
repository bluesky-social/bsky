import { l, record } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import { LexIndexer } from '../../src/lex-indexer.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

describe('LexIndexer registration', () => {
  it('accumulates registered commit-collection NSIDs into `collections`', () => {
    const ix = new LexIndexer().commit(likeSchema, {
      put: (e) => {
        // type-level: e.record.subject is a string; e.uri/did/cid present
        void (e.record.subject satisfies string)
        void e.uri
      },
      del: (e) => void e.uri,
    })
    expect(ix.collections).toEqual(['app.test.like'])
  })

  it('.commit / .identity / .account are chainable and return the same instance', () => {
    const ix = new LexIndexer()
    const r1 = ix.commit(likeSchema, { put: () => {} })
    const r2 = r1.identity(() => {})
    const r3 = r2.account(() => {})
    expect(r1).toBe(ix)
    expect(r2).toBe(ix)
    expect(r3).toBe(ix)
  })

  it('exposes concurrency from opts (default 16)', () => {
    expect(new LexIndexer().concurrency).toBe(16)
    expect(new LexIndexer({ concurrency: 4 }).concurrency).toBe(4)
  })
})

describe('LexIndexer.kinds', () => {
  it('is undefined when nothing is registered', () => {
    expect(new LexIndexer().kinds).toBeUndefined()
  })

  it('derives "commit" from a registered collection', () => {
    const ix = new LexIndexer().commit(likeSchema, { put: () => {} })
    expect(ix.kinds).toEqual(['commit'])
  })

  it('derives one entry per registered handler, in registration order', () => {
    const ix = new LexIndexer()
      .commit(likeSchema, { put: () => {} })
      .identity(() => {})
      .account(() => {})
      .sync(() => {})
    expect(ix.kinds).toEqual(['commit', 'identity', 'account', 'sync'])
  })

  it('onValidationError alone implies nothing (no collection registered)', () => {
    const ix = new LexIndexer().onValidationError(() => {})
    expect(ix.kinds).toBeUndefined()
  })

  it('identity/account/sync handlers derive their own kind without a collection', () => {
    expect(new LexIndexer().identity(() => {}).kinds).toEqual(['identity'])
    expect(new LexIndexer().account(() => {}).kinds).toEqual(['account'])
    expect(new LexIndexer().sync(() => {}).kinds).toEqual(['sync'])
  })
})
