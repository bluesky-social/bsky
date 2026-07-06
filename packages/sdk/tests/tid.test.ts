import { describe, expect, it } from 'vitest'
import { nextTid } from '../src/tid.js'

describe('nextTid', () => {
  it('generates 13-character s32 formatted TIDs', () => {
    const tid = nextTid()
    expect(tid).toMatch(/^[2-7a-z]{13}$/)
  })

  it('generates multiple unique TIDs', () => {
    const tids = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const tid = nextTid()
      expect(tids.has(tid)).toBe(false)
      tids.add(tid)
    }
    expect(tids.size).toBe(10)
  })

  it('maintains strict increasing order across consecutive calls', () => {
    const tid1 = nextTid()
    const tid2 = nextTid()
    const tid3 = nextTid()

    expect(tid1 < tid2).toBe(true)
    expect(tid2 < tid3).toBe(true)
  })

  it('generates 1000 unique and sorted TIDs in burst', () => {
    const tids: string[] = []
    for (let i = 0; i < 1000; i++) {
      tids.push(nextTid())
    }

    // Check all unique
    const uniqueTids = new Set(tids)
    expect(uniqueTids.size).toBe(1000)

    // Check sorted
    for (let i = 1; i < tids.length; i++) {
      expect(tids[i - 1] < tids[i]).toBe(true)
    }
  })
})
