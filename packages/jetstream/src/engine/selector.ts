import { type SegEvent } from '../segment/block.js'
import { type SegKind, isCommitKind } from '../segment/kind.js'
import { collectionMatches } from './collections.js'

/**
 * The client-side exact filter for archive rows. The server's plan is
 * one-sided (false positives allowed), so every decoded row is re-checked
 * here.
 */
export interface RowSelector {
  keep(ev: SegEvent): boolean
  /** Column-level form of keep() for filter-aware decode: same rule, applied
   * before row materialization. Must stay semantically identical to keep(). */
  keepRow(collection: string, did: string, kind: SegKind): boolean
}

export function makeSelector(opts: {
  dids?: readonly string[]
  collections: string[]
}): RowSelector {
  const didSet = opts.dids?.length ? new Set<string>(opts.dids) : null
  const keepRow = (collection: string, did: string, kind: SegKind): boolean => {
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
      return keepRow(ev.collection, ev.did, ev.kind)
    },
  }
}
