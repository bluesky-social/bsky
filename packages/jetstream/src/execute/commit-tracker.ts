import { type CursorStore } from './cursor-store.js'

export class CommitTracker {
  private readonly store: CursorStore | undefined
  private readonly tracked: number[] = []
  private readonly doneSet = new Set<number>()
  private mark = 0
  private savePromise: Promise<void> | undefined

  constructor(store?: CursorStore) {
    this.store = store
  }

  track(seq: number): void {
    // Dispatch is in ascending seq order; push maintains the invariant.
    this.tracked.push(seq)
  }

  done(seq: number): void {
    this.doneSet.add(seq)
    let cursor = 0 // index into tracked of the next not-yet-confirmed seq
    while (
      cursor < this.tracked.length &&
      this.doneSet.has(this.tracked[cursor])
    ) {
      this.mark = this.tracked[cursor]
      this.doneSet.delete(this.tracked[cursor])
      cursor++
    }
    // Trim consumed prefix to bound memory usage
    if (cursor > 0) {
      this.tracked.splice(0, cursor)
    }
    this.scheduleSave()
  }

  watermark(): number {
    return this.mark
  }

  async flush(): Promise<void> {
    if (!this.store) return
    // Ensure a save covering the current mark is scheduled, then wait for drain.
    this.scheduleSave()
    await this.savePromise
  }

  // Coalesced save: at most one in-flight store.save; the loop re-saves until
  // the saved value catches up with the latest watermark, so saves requested
  // during an in-flight save collapse into exactly one more.
  private scheduleSave(): void {
    if (!this.store) return
    if (!this.savePromise) {
      this.savePromise = this.runSaveLoop()
    }
  }

  private async runSaveLoop(): Promise<void> {
    try {
      let saved: number
      do {
        saved = this.mark
        await this.store!.save(saved)
      } while (saved !== this.mark)
    } finally {
      this.savePromise = undefined
    }
  }
}
