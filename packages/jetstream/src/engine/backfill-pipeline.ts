import { rawEventFromSegment } from '../decode-event.js'
import { type EventBatch, type RawEvent } from '../event.js'
import { type RawRecordCbor } from '../raw-record.js'
import { type Decompressor, type Sha256 } from '../runtime/interface.js'
import { decodeBlockFrame } from '../segment/block.js'
import { type PlanEntry } from '../xrpc/plan.js'
import { type RetryPolicy } from '../xrpc/retry.js'
import { blockSource } from './block-source.js'
import { type RowSelector } from './selector.js'

export interface BackfillPipelineOpts {
  host: string
  entries: PlanEntry[]
  selector: RowSelector
  fetchImpl: typeof fetch
  decompressor: Decompressor
  sha256: Sha256
  signal?: AbortSignal
  outstandingHwmBytes?: number
  tailHwmBytes?: number
  blockConcurrency?: number
  retry?: RetryPolicy
  validateWire?: boolean
}

/**
 * Decompresses + decodes each block frame from blockSource into one
 * EventBatch per block, selector-filtered, in seq order. Fail-fast: a decode
 * error (MalformedError) or a propagating DownloadError throws after the
 * clean ascending prefix already yielded — never skips a block.
 */
export async function* backfillBatches(
  opts: BackfillPipelineOpts,
): AsyncGenerator<EventBatch<RawEvent<RawRecordCbor>>> {
  for await (const chunk of blockSource({
    host: opts.host,
    entries: opts.entries,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
    outstandingHwmBytes: opts.outstandingHwmBytes,
    tailHwmBytes: opts.tailHwmBytes,
    blockConcurrency: opts.blockConcurrency,
    retry: opts.retry,
  })) {
    const rows = decodeBlockFrame(
      chunk.frame,
      opts.decompressor,
      opts.selector.keepRow,
    )
    const events: RawEvent<RawRecordCbor>[] = []
    let lastCursor = 0
    for (const r of rows) {
      const ev = rawEventFromSegment(r, {
        sha256: opts.sha256,
        validateWire: opts.validateWire,
      })
      events.push(ev)
      if (ev.seq > lastCursor) lastCursor = ev.seq
    }
    if (events.length === 0) continue
    yield { events, lastCursor }
  }
}
