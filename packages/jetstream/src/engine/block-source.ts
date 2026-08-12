import { type PlanEntry } from '../xrpc/plan.js'
import { getBlock, streamSegment } from '../xrpc/download.js'
import { streamSegmentFrames } from '../segment/segment-reader.js'
import { type RetryPolicy } from '../xrpc/retry.js'

export interface BlockChunk {
  entryIndex: number
  entry: PlanEntry
  frame: Uint8Array
}

export interface BlockSourceOpts {
  host: string
  entries: PlanEntry[]
  fetchImpl: typeof fetch
  signal?: AbortSignal
  outstandingHwmBytes?: number
  tailHwmBytes?: number
  blockConcurrency?: number
  retry?: RetryPolicy
}

const DEFAULT_HWM = 32 * 1024 * 1024

// A "download" is one segment file or one block. This scheduler processes the
// plan's downloads in strict order (the "head"), yielding each download's
// frames in order, while prefetching eligible next downloads (the "tails") so
// the head->next handoff has no network gap. At most 1 segment and at most
// blockConcurrency blocks are in flight.
//
// Because only the head yields into the output stream and downloads are
// consumed in plan order (entries partition seq space ascending), frames are
// emitted in strict seq order with no reorder buffer.
type Download =
  | { kind: 'segment'; entryIndex: number; entry: PlanEntry }
  | {
      kind: 'block'
      entryIndex: number
      entry: PlanEntry
      blockIndex: number
    }

export async function* blockSource(
  opts: BlockSourceOpts,
): AsyncGenerator<BlockChunk> {
  const { host, entries, fetchImpl, signal } = opts
  const retry = opts.retry
  const outstandingHwm = opts.outstandingHwmBytes ?? DEFAULT_HWM
  const tailHwm = opts.tailHwmBytes ?? DEFAULT_HWM
  const maxBlocks = Math.max(1, opts.blockConcurrency ?? 4)

  // Flatten the plan into an ordered list of downloads (unit = segment | block).
  const downloads: Download[] = []
  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e]
    if (entry.mode === 'segment') {
      downloads.push({ kind: 'segment', entryIndex: e, entry })
    } else {
      for (const br of entry.blocks ?? []) {
        for (let b = br.first; b <= br.last; b++) {
          downloads.push({ kind: 'block', entryIndex: e, entry, blockIndex: b })
        }
      }
    }
  }

  // Ordered frames for a single download. A download error propagates (not
  // swallowed): it surfaces out of the head's drain() at the correct ordered
  // position, so the consumer can recover without a gap.
  async function* framesOf(d: Download): AsyncGenerator<Uint8Array> {
    if (d.kind === 'segment') {
      yield* streamSegmentFrames(
        streamSegment(host, d.entry.name, fetchImpl, signal, retry),
      )
    } else {
      yield await getBlock(
        host,
        d.entry.name,
        d.blockIndex,
        fetchImpl,
        signal,
        retry,
      )
    }
  }

  // A single-slot look-ahead. When constructed it immediately begins pumping
  // the download's frames into a bounded buffer. Consumers drain via drain():
  // each frame is handed out in order; when the buffer is empty the drain
  // awaits the pump. The pump pauses at limitBytes buffered and resumes as
  // drain() consumes — byte-based backpressure.
  //
  // The same object serves as the head (a promoted tail, or a freshly started
  // head): draining it to completion is what emits the head's frames.
  class Prefetch {
    readonly d: Download
    readonly #buf: Uint8Array[] = []
    #bytes = 0
    #done = false
    #err: unknown = undefined
    // Resolver signalling "buffer changed" (frame pushed, pump finished, or
    // drain consumed a frame). A single shared latch woken on every transition.
    #wake: (() => void) | null = null
    readonly #pump: Promise<void>
    readonly #limitBytes: number

    constructor(d: Download, limitBytes: number) {
      this.d = d
      this.#limitBytes = limitBytes
      this.#pump = this.#run()
    }

    #notify() {
      const w = this.#wake
      this.#wake = null
      if (w) w()
    }

    #wait(): Promise<void> {
      return new Promise<void>((resolve) => {
        this.#wake = resolve
      })
    }

    async #run(): Promise<void> {
      try {
        for await (const f of framesOf(this.d)) {
          this.#buf.push(f)
          this.#bytes += f.length
          this.#notify()
          // HWM: stop reading ahead while the buffer is full; resume when
          // drain() consumes bytes. Observe abort so this can't spin forever.
          while (this.#bytes >= this.#limitBytes && !signal?.aborted) {
            await this.#wait()
          }
        }
      } catch (e) {
        // Stored here so the pump promise never rejects unhandled; drain()
        // rethrows it in-order after the buffered frames, and settle()
        // surfaces it on the drop path.
        this.#err = e
      } finally {
        this.#done = true
        this.#notify()
      }
    }

    // Yield buffered frames in order, awaiting the pump for more, until the
    // download is exhausted. Draining releases HWM backpressure on the pump.
    async *drain(): AsyncGenerator<Uint8Array> {
      for (;;) {
        if (this.#buf.length > 0) {
          const f = this.#buf.shift()!
          this.#bytes -= f.length
          this.#notify() // room freed -> pump may resume
          yield f
          continue
        }
        if (this.#done) {
          if (this.#err) throw this.#err
          return
        }
        await this.#wait()
      }
    }

    // Let the pump run to completion without emitting (drop a prefetch
    // cleanly on abort, or settle healthy tails after the head threw). Any
    // pump error is swallowed here: this is the drop path, so a tail's own
    // download error must not surface (it would mask the head's in-order
    // error or leak unhandled); the head surfaces its error via drain().
    async settle(): Promise<void> {
      try {
        for await (const _f of this.drain()) {
          void _f
        }
      } catch {
        // dropped prefetch: its error is not the ordered failure we report
      }
      await this.#pump
    }
  }

  if (signal?.aborted) return
  if (downloads.length === 0) return

  // Ordered prefetch window. window[0] is the head: it drains and emits fully
  // before being dequeued, so only the plan-earliest remaining download
  // yields. window[1..] are look-aheads already downloading. Budgets bound
  // the in-flight set: at most 1 segment AND at most maxBlocks blocks. next
  // is the index of the first not-yet-launched download.
  const window: Prefetch[] = []
  let next = 0

  const countKind = (kind: Download['kind']): number =>
    window.reduce((n, p) => (p.d.kind === kind ? n + 1 : n), 0)

  // Admit consecutive downloads into the window while each one's kind-budget
  // allows. Stop at the first that would violate its budget (never skip past
  // it — order must hold). A slot constructed while the window is empty is
  // the head and gets outstandingHwm; any look-ahead gets tailHwm (and keeps
  // it if later promoted to head).
  const fill = () => {
    while (next < downloads.length) {
      const d = downloads[next]
      if (d.kind === 'segment') {
        if (countKind('segment') >= 1) break
      } else {
        if (countKind('block') >= maxBlocks) break
      }
      const limit = window.length === 0 ? outstandingHwm : tailHwm
      window.push(new Prefetch(d, limit))
      next++
    }
  }

  const drainAll = async () => {
    // Teardown: let every in-flight prefetch settle so no pump promise is
    // left to reject unhandled.
    while (window.length > 0) {
      const p = window.shift()!
      await p.settle()
    }
  }

  fill()
  while (window.length > 0) {
    if (signal?.aborted) {
      await drainAll()
      return
    }
    const head = window[0]
    // Refill BEFORE draining so prefetches for the slots behind the head are
    // already in flight while the head streams.
    fill()
    try {
      for await (const frame of head.drain()) {
        if (signal?.aborted) {
          await drainAll()
          return
        }
        yield { entryIndex: head.d.entryIndex, entry: head.d.entry, frame }
      }
    } catch (err) {
      // The head's download errored after a clean ascending prefix. Drop the
      // failed head first (its pump already errored — do not re-drain it),
      // then settle the healthy tails so no pump promise leaks, then rethrow
      // in-order so the consumer can recover without a gap.
      window.shift()
      await drainAll()
      throw err
    }
    // Head exhausted: dequeue it, then top the window back up.
    window.shift()
    fill()
  }
}
