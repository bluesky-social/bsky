import { type CursorStore } from './cursor-store.js'

export class CommitTracker {
  private readonly store: CursorStore | undefined
  private readonly tracked: number[] = []
  private readonly doneSet = new Set<number>()
  private cursor = 0 // index into tracked of the next not-yet-confirmed seq
  private mark = 0
  private savePromise: Promise<void> | undefined
  private pendingSave = false

  constructor(store?: CursorStore) {
    this.store = store
  }

  track(seq: number): void {
    // Dispatch is in ascending seq order; push maintains the invariant.
    this.tracked.push(seq)
  }

  done(seq: number): void {
    this.doneSet.add(seq)
    while (
      this.cursor < this.tracked.length &&
      this.doneSet.has(this.tracked[this.cursor])
    ) {
      this.mark = this.tracked[this.cursor]
      this.doneSet.delete(this.tracked[this.cursor])
      this.cursor++
    }
    // Trim consumed prefix to bound memory usage
    if (this.cursor > 0) {
      this.tracked.splice(0, this.cursor)
      this.cursor = 0
    }
    void this.scheduleSave()
  }

  watermark(): number {
    return this.mark
  }

  async flush(): Promise<void> {
    if (!this.store) return
    // Ensure a save covering the current mark is scheduled, then wait for drain.
    this.pendingSave = true
    if (!this.savePromise) {
      this.savePromise = this.runSaveLoop()
    }
    await this.savePromise
  }

  // Coalesced save: at most one in-flight store.save; a request during a save
  // triggers exactly one more save afterward with the latest watermark.
  private scheduleSave(): void {
    if (!this.store) return
    this.pendingSave = true
    if (!this.savePromise) {
      this.savePromise = this.runSaveLoop()
    }
  }

  private async runSaveLoop(): Promise<void> {
    try {
      do {
        this.pendingSave = false
        await this.store!.save(this.mark)
      } while (this.pendingSave)
    } finally {
      this.savePromise = undefined
    }
  }
}
