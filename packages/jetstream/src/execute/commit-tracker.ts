import { type CursorStore } from './cursor-store.js'

export class CommitTracker {
  private readonly store: CursorStore | undefined
  private readonly tracked: number[] = []
  private readonly doneSet = new Set<number>()
  // undefined until the first ack completes a contiguous prefix. A run that
  // acks nothing must never save — a 0 would clobber a previously stored
  // cursor (e.g. a snapshot resumed at the tip, or a live run that dies
  // before delivering anything).
  private mark: number | undefined
  private savePromise: Promise<void> | undefined

  constructor(store?: CursorStore) {
    this.store = store
  }

  track(seq: number): void {
    // Dispatch is in ascending seq order; push maintains the invariant.
    this.tracked.push(seq)
  }

  /**
   * Registers scanned-through coverage at its stream position: once every
   * event tracked before it is done, the watermark advances to `throughSeq`
   * (never backwards). Zero is valid coverage. Encoded in the same ordered
   * list as -(throughSeq + 1), so it cannot collide with a seq and costs the
   * event path nothing.
   */
  trackCoverage(throughSeq: number): void {
    this.tracked.push(-(throughSeq + 1))
    this.#advance()
  }

  done(seq: number): void {
    this.doneSet.add(seq)
    this.#advance()
  }

  // Confirms the longest prefix of tracked entries whose events are done;
  // coverage entries confirm as soon as everything before them has.
  #advance(): void {
    let cursor = 0 // index into tracked of the next not-yet-confirmed entry
    while (cursor < this.tracked.length) {
      const entry = this.tracked[cursor]
      if (entry < 0) {
        const through = -entry - 1
        if (this.mark === undefined || through > this.mark) this.mark = through
      } else if (this.doneSet.has(entry)) {
        this.mark = entry
        this.doneSet.delete(entry)
      } else {
        break
      }
      cursor++
    }
    // Trim consumed prefix to bound memory usage
    if (cursor > 0) {
      this.tracked.splice(0, cursor)
    }
    this.scheduleSave()
  }

  watermark(): number {
    return this.mark ?? 0
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
    if (!this.store || this.mark === undefined) return
    if (!this.savePromise) {
      this.savePromise = this.runSaveLoop()
    }
  }

  private async runSaveLoop(): Promise<void> {
    try {
      let saved: number
      do {
        saved = this.mark!
        await this.store!.save(saved)
      } while (saved !== this.mark)
    } finally {
      this.savePromise = undefined
    }
  }
}
