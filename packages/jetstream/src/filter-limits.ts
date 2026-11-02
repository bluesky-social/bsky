import { type SpacesKind } from './event.js'

/**
 * Server-side caps on the v2 filter axes, shared by the live wire
 * (`subscribeEvents` params) and the archive planner (`planSnapshot` input).
 * Both lexicons declare the same maxLengths. A Spaces server accepts the fifth
 * kind, `scope`.
 */
export const MAX_FILTER_KINDS = 4
export const MAX_SPACES_FILTER_KINDS = 5
export const MAX_FILTER_DIDS = 10_000
export const MAX_FILTER_COLLECTIONS = 100

export interface WireFilters {
  kinds?: readonly SpacesKind[]
  dids?: readonly string[]
  collections?: readonly string[]
}

/**
 * Checks a filter triple against the rules the server enforces, so a violation
 * fails locally with a message naming the fix.
 *
 * Both endpoints answer a violation with InvalidRequest, but neither surfaces
 * it usefully: the live wire rejects pre-upgrade with an HTTP 400 whose body
 * the default websocket transport discards, and inside `cutoverReplay` a bare
 * 400 handshake is classified as cursor-too-old — so a bad filter would burn
 * the whole re-plan budget before failing with the wrong reason.
 *
 * `spaces` selects the Spaces contract. Without it the `scope` kind is never
 * sent: a public server does not know it.
 */
export function assertWireFilters(f: WireFilters, spaces = false): void {
  if (!spaces && f.kinds?.includes('scope')) {
    throw new Error(
      "the scope kind exists only on a Spaces archive: construct Jetstream with mode: 'spaces'",
    )
  }
  const maxKinds = spaces ? MAX_SPACES_FILTER_KINDS : MAX_FILTER_KINDS
  if ((f.kinds?.length ?? 0) > maxKinds) {
    throw new RangeError(`kinds filter exceeds the server limit of ${maxKinds}`)
  }
  if ((f.dids?.length ?? 0) > MAX_FILTER_DIDS) {
    throw new RangeError(
      `dids filter exceeds the server limit of ${MAX_FILTER_DIDS}`,
    )
  }
  if ((f.collections?.length ?? 0) > MAX_FILTER_COLLECTIONS) {
    throw new RangeError(
      `collections filter exceeds the server limit of ${MAX_FILTER_COLLECTIONS}`,
    )
  }
  // The collections axis constrains commits only, so a kinds list without
  // 'commit' makes it unsatisfiable. The server rejects the pair rather than
  // silently ignoring either side, and so do we.
  if (f.collections?.length && f.kinds?.length && !f.kinds.includes('commit')) {
    throw new Error(
      "collections filter can never apply: kinds excludes 'commit' " +
        '(add commit to kinds, or drop the collections filter — it does not ' +
        'constrain identity/account/sync events)',
    )
  }
}
