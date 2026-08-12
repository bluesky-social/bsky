import { type DidString } from '@atproto/lex'
import { type Plan, planSnapshot } from '../xrpc/plan.js'

export interface PlanPagesOpts {
  host: string
  dids?: DidString[]
  collections: string[]
  afterSeq?: number
  beforeSeq?: number
  fetchImpl: typeof fetch
  signal?: AbortSignal
}

/**
 * Pages planSnapshot across the whole sealed archive. Pins sealedTipSeq on
 * the first page, then advances afterSeq = plannedThroughSeq with beforeSeq
 * pinned to the sealed tip, so the snapshot stays stable while the live tip
 * advances. Terminates when plannedThroughSeq >= sealedTipSeq (an empty
 * archive terminates on the first page). Throws if the continuation cursor
 * fails to advance — the anti-spin guard against a stale or hostile server.
 *
 * All state is transient: a resumed run reconstructs position from afterSeq.
 */
export async function* planPages(opts: PlanPagesOpts): AsyncGenerator<Plan> {
  let cursor = opts.afterSeq ?? 0
  let sealedTip = 0
  let pinned = false
  for (;;) {
    const page = await planSnapshot(
      {
        host: opts.host,
        dids: opts.dids,
        collections: opts.collections,
        afterSeq: cursor,
        beforeSeq: pinned ? sealedTip : opts.beforeSeq,
      },
      opts.fetchImpl,
      opts.signal,
    )
    if (!pinned) {
      sealedTip = page.sealedTipSeq
      pinned = true
    }
    yield page

    const prev = cursor
    cursor = page.plannedThroughSeq
    if (cursor >= sealedTip) return // whole sealed archive planned (incl. empty: 0 >= 0)
    if (cursor <= prev) {
      throw new Error(
        `jetstream: planSnapshot made no progress: afterSeq=${prev} plannedThroughSeq=${cursor} sealedTipSeq=${sealedTip}`,
      )
    }
  }
}
