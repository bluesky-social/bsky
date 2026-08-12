import { expect, test } from 'vitest'
import { CommitTracker } from '../../src/execute/commit-tracker.js'
import { MemoryCursorStore } from '../../src/execute/cursor-store.js'

test('watermark only advances past the contiguous completed prefix', async () => {
  const store = new MemoryCursorStore()
  const t = new CommitTracker(store)
  t.track(1)
  t.track(2)
  t.track(3)
  t.done(2) // 1 still pending -> watermark stays 0
  expect(t.watermark()).toBe(0)
  t.done(1) // now 1,2 contiguous -> watermark 2
  expect(t.watermark()).toBe(2)
  t.done(3) // 3 -> watermark 3
  expect(t.watermark()).toBe(3)
  await t.flush()
  expect(await store.load()).toBe(3)
})

test('out-of-order completion across gaps holds the watermark', () => {
  const t = new CommitTracker()
  for (const s of [10, 11, 12, 13]) t.track(s)
  t.done(11)
  t.done(12)
  t.done(13)
  expect(t.watermark()).toBe(0) // 10 never done
  t.done(10)
  expect(t.watermark()).toBe(13)
})

// ---------------------------------------------------------------------------
// Helper: a store whose save() hangs until manually released.
// ---------------------------------------------------------------------------
interface DeferredStore {
  calls: number[]
  resolve: () => void
  save: (seq: number) => Promise<void>
}

function makeDeferredStore(): DeferredStore {
  let resolve: () => void = () => {}
  let waitPromise: Promise<void> = new Promise((r) => {
    resolve = r
  })
  const store: DeferredStore = {
    calls: [],
    resolve: () => {},
    save: async (seq: number) => {
      store.calls.push(seq)
      await waitPromise
      // After the current gate opens, reset so next save also blocks.
      waitPromise = new Promise((r) => {
        resolve = r
        store.resolve = r
      })
    },
  }
  store.resolve = resolve
  return store
}

test('coalescing: multiple done() while a save is in-flight only trigger one further save', async () => {
  const ds = makeDeferredStore()
  const t = new CommitTracker(
    ds as unknown as import('../../src/execute/cursor-store.js').CursorStore,
  )

  t.track(1)
  t.track(2)
  t.track(3)
  t.track(4)

  // Complete seq 1 — this starts the first in-flight save(1)
  t.done(1)
  // Let the microtask queue run so the save loop fires and reaches await store.save()
  await Promise.resolve()
  await Promise.resolve()

  expect(ds.calls).toEqual([1]) // one save started, not resolved yet

  // While the first save is in-flight, advance the watermark further
  t.done(2)
  t.done(3)
  t.done(4)
  // No additional saves should have started yet
  expect(ds.calls).toEqual([1])

  // Release the first in-flight save
  ds.resolve()
  // Let the save loop tick: it sees pendingSave=true and does one more save
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  expect(ds.calls).toEqual([1, 4]) // coalesced: exactly one follow-up save with latest mark

  // Unblock the second save so we don't leave a dangling promise
  ds.resolve()
  await Promise.resolve()
  await Promise.resolve()
})

test('flush() resolves only after the current watermark is durably saved', async () => {
  const ds = makeDeferredStore()
  const t = new CommitTracker(
    ds as unknown as import('../../src/execute/cursor-store.js').CursorStore,
  )

  t.track(1)
  t.track(2)
  t.done(1)
  // Let the save loop start
  await Promise.resolve()
  await Promise.resolve()

  t.done(2) // mark advances to 2 but save is still in-flight

  let flushed = false
  const flushPromise = t.flush().then(() => {
    flushed = true
  })

  // flush should not resolve yet — first save is still blocked
  await Promise.resolve()
  await Promise.resolve()
  expect(flushed).toBe(false)

  // Release the first in-flight save; the loop will do one more save(2)
  ds.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  // Still waiting: the second save (for mark=2) is now in-flight
  expect(flushed).toBe(false)

  // Release the second save
  ds.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  await flushPromise
  expect(flushed).toBe(true)
  expect(ds.calls).toEqual([1, 2])
})

test('flush() with no store resolves immediately without error', async () => {
  const t = new CommitTracker()
  t.track(1)
  t.done(1)
  await expect(t.flush()).resolves.toBeUndefined()
})

test('flush() does not issue a concurrent save while one is in-flight', async () => {
  // Track concurrent saves using a counter
  let concurrentSaves = 0
  let maxConcurrentSaves = 0
  const savedSeqs: number[] = []
  let releaseCurrentSave: () => void = () => {}

  const controlledStore = {
    save: async (seq: number): Promise<void> => {
      concurrentSaves++
      maxConcurrentSaves = Math.max(maxConcurrentSaves, concurrentSaves)
      savedSeqs.push(seq)
      await new Promise<void>((resolve) => {
        releaseCurrentSave = resolve
      })
      concurrentSaves--
    },
  }

  const t = new CommitTracker(
    controlledStore as unknown as import('../../src/execute/cursor-store.js').CursorStore,
  )

  t.track(1)
  t.done(1)
  // Let first save start
  await Promise.resolve()
  await Promise.resolve()
  expect(savedSeqs).toEqual([1])
  expect(concurrentSaves).toBe(1)

  // Call flush() while first save is in-flight
  const flushPromise = t.flush()
  await Promise.resolve()
  await Promise.resolve()

  // Still only one in-flight save (flush is waiting, not starting a new one)
  expect(concurrentSaves).toBe(1)
  expect(maxConcurrentSaves).toBe(1)

  // Release the first save; the loop will coalesce and do one more save(1)
  releaseCurrentSave()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  // Release the coalesced save
  releaseCurrentSave()
  await flushPromise

  // Never more than one concurrent save
  expect(maxConcurrentSaves).toBe(1)
})

test('a run that acks nothing never saves (a 0 would clobber a stored cursor)', async () => {
  const calls: number[] = []
  const t = new CommitTracker({
    load: async () => 3,
    save: async (seq) => {
      calls.push(seq)
    },
  })
  t.track(4) // pulled but never acked
  await t.flush()
  expect(calls).toEqual([])
  expect(t.watermark()).toBe(0)
})
