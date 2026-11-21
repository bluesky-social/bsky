import { l, record } from '@atproto/lex'
import { describe, expect, test } from 'vitest'
import { CommitTracker } from '../../src/execute/commit-tracker.js'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'
import { Jetstream } from '../../src/jetstream.js'
import { LexIndexer } from '../../src/lex-indexer.js'
import { fakeArchive } from './fake-archive.js'

const note = record('tid', 'app.example.note', l.object({ text: l.string() }))
const service = 'https://archive.example'

describe('CommitTracker coverage', () => {
  test('zero coverage is a real checkpoint', async () => {
    const store = new MemoryCursorStore()
    const t = new CommitTracker(store)
    t.trackCoverage(0)
    await t.flush()
    expect(await store.load()).toBe(0)
  })

  test('coverage waits for every earlier event, then jumps past empty ranges', () => {
    const t = new CommitTracker()
    t.track(3)
    t.track(5)
    t.trackCoverage(9)
    t.done(5)
    expect(t.watermark()).toBe(0)
    t.done(3)
    expect(t.watermark()).toBe(9)
    t.trackCoverage(7) // never backwards
    expect(t.watermark()).toBe(9)
    t.trackCoverage(20) // nothing pending: advances at once
    expect(t.watermark()).toBe(20)
  })

  test('a failed event holds the checkpoint below it', () => {
    const t = new CommitTracker()
    t.track(3)
    t.track(5)
    t.trackCoverage(9)
    t.done(3)
    expect(t.watermark()).toBe(3)
  })
})

describe('Spaces LexIndexer', () => {
  test('rejects configuration that would reorder events', () => {
    expect(() => new LexIndexer({ mode: 'spaces', concurrency: 4 })).toThrow(
      /serially/,
    )
    expect(
      () => new LexIndexer({ mode: 'spaces', keyOf: () => 'k' } as never),
    ).toThrow(/serially/)
    expect(new LexIndexer({ mode: 'spaces', concurrency: 1 }).concurrency).toBe(
      1,
    )
    expect(() => new LexIndexer({ mode: 'other' as never })).toThrow(TypeError)
  })

  test('kinds include scope once a scope handler is registered', () => {
    const ix = new LexIndexer({ mode: 'spaces' }).scope(() => {})
    expect(ix.kinds).toContain('scope')
    expect(new LexIndexer().kinds).toBeUndefined()
  })

  test('runs the archive in order with space and scope inputs, then checkpoints progress', async () => {
    const log: string[] = []
    let inFlight = 0
    const step = async (entry: string) => {
      expect(inFlight).toBe(0) // strictly serial
      inFlight++
      await Promise.resolve()
      log.push(entry)
      inFlight--
    }
    const ix = new LexIndexer({ mode: 'spaces' })
      .commit(note, {
        put: (e) =>
          step(`put ${e.seq} ${e.space ?? '-'} ${e.record.text.length > 0}`),
        del: (e) => step(`del ${e.seq} ${e.space ?? '-'}`),
      })
      .sync((e) => step(`sync ${e.seq} ${e.space ?? '-'}`))
      .scope((e) =>
        step(
          e.operation === 'repoRemoved'
            ? `repoRemoved ${e.seq} ${e.space} ${e.did.slice(-4)}`
            : `spaceDeleted ${e.seq} ${e.space}`,
        ),
      )
      .account((e) => step(`account ${e.seq}`))
      .identity((e) => step(`identity ${e.seq}`))
    const archive = fakeArchive()
    const cursor = new MemoryCursorStore()
    const js = new Jetstream({
      service,
      mode: 'spaces',
      fetchImpl: archive.fetch,
    })
    await js.runner(ix).snapshot({ cursor, progress: true })
    expect(log).toEqual([
      'put 1 - true',
      'put 2 space:a true',
      'del 3 space:b',
      'sync 4 space:a',
      'repoRemoved 5 space:b qzhb',
      'spaceDeleted 6 space:c',
      'account 7',
      'identity 8',
    ])
    // Row 9 is outside the registered collection: certified by progress.
    expect(await cursor.load()).toBe(9)
    expect(archive.requests[1].body).toMatchObject({
      protocolVersion: 2,
      collections: ['app.example.note'],
      kinds: ['commit', 'identity', 'account', 'sync', 'scope'],
    })
  })

  test('a failing handler stops the run and keeps the cursor below it', async () => {
    const ix = new LexIndexer({ mode: 'spaces' })
      .commit(note, { put: () => {}, del: () => {} })
      .sync(() => {})
      .scope(() => {
        throw new Error('cannot purge')
      })
    const cursor = new MemoryCursorStore()
    const js = new Jetstream({
      service,
      mode: 'spaces',
      fetchImpl: fakeArchive().fetch,
    })
    await expect(
      js.runner(ix).snapshot({ cursor, progress: true }),
    ).rejects.toThrow('cannot purge')
    expect(await cursor.load()).toBe(4)
  })

  test('a Spaces runner refuses a public consumer', () => {
    const js = new Jetstream({
      service,
      mode: 'spaces',
      fetchImpl: fakeArchive().fetch,
    })
    expect(() => js.runner(new LexIndexer() as never)).toThrow(
      /Spaces consumer/,
    )
  })
})
