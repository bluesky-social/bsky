import { type DidString, type InferOutput, l, xrpc } from '@atproto/lex'
import { type Kind } from '../event.js'
import { assertWireFilters } from '../filter-limits.js'

// The planSnapshot wire contract, declared once by hand (this package does
// not generate lexicon clients). `mode` stays an open string so a newer
// server's modes are not rejected here; consumers treat non-'blocks' entries
// by their declared mode and unknown values surface downstream.
const blockRange = l.object({
  first: l.integer({ minimum: 0 }),
  last: l.integer({ minimum: 0 }),
})

const segment = l.object({
  name: l.string(),
  index: l.integer({ minimum: 0 }),
  checksum: l.string({ minLength: 16, maxLength: 16 }),
  minSeq: l.integer({ minimum: 0 }),
  maxSeq: l.integer({ minimum: 0 }),
  mode: l.string(),
  blocks: l.optional(l.array(blockRange)),
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

export type BlockRange = InferOutput<typeof blockRange>
/** One planned download unit: a whole segment or block ranges within one. */
export type PlanEntry = InferOutput<typeof segment>
export type Plan = {
  plannedThroughSeq: number
  sealedTipSeq: number
  segments: PlanEntry[]
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
  kinds?: Kind[]
  dids?: DidString[]
  collections?: string[]
  afterSeq?: number
  beforeSeq?: number
}

export async function planSnapshot(
  req: PlanRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Plan> {
  assertWireFilters(req)
  const body: l.InferPayloadBody<typeof input, l.BinaryData> = {}
  if (req.kinds?.length) body.kinds = req.kinds
  if (req.dids?.length) body.dids = req.dids
  if (req.collections?.length) body.collections = req.collections
  if (req.afterSeq !== undefined) body.afterSeq = req.afterSeq
  if (req.beforeSeq !== undefined) body.beforeSeq = req.beforeSeq

  const res = await xrpc(
    { service: req.host, fetch: fetchImpl },
    planSnapshotDef,
    { body, signal },
  )
  return res.body
}
