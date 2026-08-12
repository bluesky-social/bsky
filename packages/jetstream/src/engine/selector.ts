import { type SegEvent } from '../segment/block.js'
import { type SegKind, isCommitKind } from '../segment/kind.js'
import { collectionMatches } from './collections.js'

/**
 * Mutable seq bounds for the selector. The plan is one-sided at the seq level
 * too: a block straddling afterSeq is planned whole, so rows at or below the
 * floor (and above the ceiling) must be pruned client-side. The floor is
 * mutable because re-plan/re-backfill recovery advances it mid-run.
 */
export interface SeqWindow {
  /** Exclusive floor: rows with seq <= afterSeq are dropped. */
  afterSeq: number
  /** Inclusive ceiling: rows with seq > beforeSeq are dropped. */
  beforeSeq?: number
}

/**
 * The client-side exact filter for archive rows. The server's plan is
 * one-sided (false positives allowed), so every decoded row is re-checked
 * here.
 */
export interface RowSelector {
  keep(ev: SegEvent): boolean
  /** Column-level form of keep() for filter-aware decode: same rule, applied
   * before row materialization. Must stay semantically identical to keep(). */
  keepRow(collection: string, did: string, kind: SegKind, seq: number): boolean
}

export function makeSelector(opts: {
  dids?: readonly string[]
  collections: string[]
  window?: SeqWindow
}): RowSelector {
  const didSet = opts.dids?.length ? new Set<string>(opts.dids) : null
  const window = opts.window
  const keepRow = (
    collection: string,
    did: string,
    kind: SegKind,
    seq: number,
  ): boolean => {
    // The seq window applies to all kinds (read live: recovery mutates it).
    if (window) {
      if (seq <= window.afterSeq) return false
      if (window.beforeSeq !== undefined && seq > window.beforeSeq) return false
    }
    // The DID filter applies to all kinds.
    if (didSet && !didSet.has(did)) return false
    // The collection filter applies only to commit events with a non-empty
    // collection; identity/account/sync bypass it, matching the live wire.
    if (isCommitKind(kind) && collection !== '') {
      if (!collectionMatches(collection, opts.collections)) return false
    }
    return true
  }
  return {
    keepRow,
    keep(ev: SegEvent): boolean {
      return keepRow(ev.collection, ev.did, ev.kind, ev.seq)
    },
  }
}
