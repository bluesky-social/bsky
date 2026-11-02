import { type DidString, type InferOutput, l, xrpc } from '@atproto/lex'
import { type SpacesKind } from '../event.js'
import { assertWireFilters } from '../filter-limits.js'
import {
  type SpacesProtocol,
  assertNegotiatedHeaders,
  planEntryFormat,
} from './protocol.js'

// The planSnapshot wire contract, declared once by hand (this package does
// not generate lexicon clients). `mode` stays an open string so a newer
// server's modes are not rejected here; consumers treat non-'blocks' entries
// by their declared mode and unknown values surface downstream.
const blockRange = l.object({
  first: l.integer({ minimum: 0 }),
  last: l.integer({ minimum: 0 }),
})

const segmentFields = {
  name: l.string(),
  index: l.integer({ minimum: 0 }),
  checksum: l.string({ minLength: 16, maxLength: 16 }),
  minSeq: l.integer({ minimum: 0 }),
  maxSeq: l.integer({ minimum: 0 }),
  mode: l.string(),
  blocks: l.optional(l.array(blockRange)),
}
const segment = l.object(segmentFields)
// Spaces only: the artifact format of the segment and its raw blocks
// (absent means 1). The public schema above stays exactly as it was.
const spacesSegment = l.object({
  ...segmentFields,
  formatVersion: l.optional(l.integer({ minimum: 1 })),
})

const stats = l.object({
  segmentsExamined: l.integer({ minimum: 0 }),
  segmentsMatched: l.integer({ minimum: 0 }),
  blocksMatched: l.integer({ minimum: 0 }),
  entries: l.integer({ minimum: 0 }),
})

const params = l.params()
// `kinds` stays an open string array for the same reason as `mode` above: a
// kind this build does not know is the server's to reject, not ours.
const input = l.jsonPayload({
  kinds: l.optional(l.array(l.string())),
  dids: l.optional(l.array(l.string({ format: 'did' }))),
  collections: l.optional(l.array(l.string())),
  afterSeq: l.optional(l.integer({ minimum: 0 })),
  beforeSeq: l.optional(l.integer({ minimum: 0 })),
})
const output = l.jsonPayload({
  plannedThroughSeq: l.integer({ minimum: 0 }),
  sealedTipSeq: l.integer({ minimum: 0 }),
  segments: l.array(segment),
  stats,
})

const planSnapshotDef = l.procedure(
  'network.bsky.jetstream.planSnapshot',
  params,
  input,
  output,
)

// The Spaces contract: protocolVersion in the body, formatVersion per entry.
const spacesInput = l.jsonPayload({
  protocolVersion: l.integer({ minimum: 1 }),
  kinds: l.optional(l.array(l.string())),
  dids: l.optional(l.array(l.string({ format: 'did' }))),
  collections: l.optional(l.array(l.string())),
  afterSeq: l.optional(l.integer({ minimum: 0 })),
  beforeSeq: l.optional(l.integer({ minimum: 0 })),
})
const spacesPlanSnapshotDef = l.procedure(
  'network.bsky.jetstream.planSnapshot',
  params,
  spacesInput,
  l.jsonPayload({
    plannedThroughSeq: l.integer({ minimum: 0 }),
    sealedTipSeq: l.integer({ minimum: 0 }),
    segments: l.array(spacesSegment),
    stats,
  }),
)

export type BlockRange = InferOutput<typeof blockRange>
/** One planned download unit: a whole segment or block ranges within one. */
export type PlanEntry = InferOutput<typeof segment>
/** A plan entry as a Spaces archive lists it, with its artifact format. */
export type SpacesPlanEntry = InferOutput<typeof spacesSegment>
export type Plan = {
  plannedThroughSeq: number
  sealedTipSeq: number
  segments: SpacesPlanEntry[]
  stats: InferOutput<typeof stats>
}

export interface PlanRequest {
  host: string
  /**
   * Event kinds to plan for. Omitting it (or passing an empty array) keeps the
   * server's marker-safe default: the `$account`/`$identity`/`$sync` sentinel
   * blocks are admitted under a collections filter, so a collection-filtered
   * snapshot still receives the DID-level markers it must fold. An explicit
   * `['commit']` drops that baseline — correct only when the caller discards
   * non-commit events anyway.
   */
  kinds?: readonly SpacesKind[]
  dids?: DidString[]
  collections?: string[]
  afterSeq?: number
  beforeSeq?: number
  /** The Spaces contract selected for this operation; absent is public. */
  protocol?: SpacesProtocol
}

export async function planSnapshot(
  req: PlanRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Plan> {
  assertWireFilters(req, req.protocol !== undefined)
  const body: l.InferPayloadBody<typeof input, l.BinaryData> = {}
  if (req.kinds?.length) body.kinds = [...req.kinds]
  if (req.dids?.length) body.dids = req.dids
  if (req.collections?.length) body.collections = req.collections
  if (req.afterSeq !== undefined) body.afterSeq = req.afterSeq
  if (req.beforeSeq !== undefined) body.beforeSeq = req.beforeSeq

  const protocol = req.protocol
  if (!protocol) {
    const res = await xrpc(
      { service: req.host, fetch: fetchImpl },
      planSnapshotDef,
      { body, signal },
    )
    return res.body
  }
  const res = await xrpc(
    { service: req.host, fetch: fetchImpl },
    spacesPlanSnapshotDef,
    { body: { protocolVersion: protocol.protocolVersion, ...body }, signal },
  )
  assertNegotiatedHeaders(res.headers, protocol, 'planSnapshot')
  for (const entry of res.body.segments) {
    planEntryFormat(entry.formatVersion, protocol, entry.name)
  }
  return res.body
}
