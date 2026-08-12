import { type DidString } from '@atproto/lex'
import { type Sha256 } from '../decode-event.js'
import { backfillBatches } from '../engine/backfill-pipeline.js'
import { planPages } from '../engine/planner.js'
import { makeSelector } from '../engine/selector.js'
import { type EventBatch, type Kind, type RawEvent } from '../event.js'
import { type Decompressor } from '../segment/decompressor.js'
import { DownloadError } from '../xrpc/errors.js'
import { type RetryPolicy } from '../xrpc/retry.js'
import { liveEvents } from './source.js'
import { type LiveTransport } from './transport.js'

export interface CutoverParams {
  host: string
  nsids: string[]
  dids?: DidString[]
  kinds?: Kind[]
  afterSeq?: number
  beforeSeq?: number
  outstandingHwmBytes?: number
  tailHwmBytes?: number
  blockConcurrency?: number
  fetchImpl: typeof fetch
  decompressor: Decompressor
  sha256: Sha256
  transport?: LiveTransport
  signal?: AbortSignal
  onError?: (err: Error) => void
  onLiveError?: (err: Error) => void
  maxRebackfills?: number
  retry?: RetryPolicy
  validateWire?: boolean
}

// The server rejects a below-retention seq cursor pre-upgrade with an HTTP
// 400 whose body carries this stable marker; the websocket transport
// surfaces the refusal as a thrown error message containing it.
const CURSOR_TOO_OLD = 'cursor too old'

function isCursorTooOld(err: unknown): boolean {
  return err instanceof Error && err.message.includes(CURSOR_TOO_OLD)
}

/**
 * Bufferless backfill→live cutover. Pages the sealed archive, then tails
 * subscribeEvents once at cursor = max(sealedTip, resume). A thrown "cursor
 * too old" 400 (backfill outran the live retention window) re-backfills from
 * the last delivered seq and reconnects, bounded by maxRebackfills with an
 * anti-spin guard. No client buffer or flip — the phases are sequential.
 */
export async function* cutoverReplay(
  ctx: CutoverParams,
): AsyncGenerator<EventBatch<RawEvent>> {
  if (ctx.signal?.aborted) return

  const maxRebackfills = ctx.maxRebackfills ?? 50
  const selector = makeSelector({ dids: ctx.dids, collections: ctx.nsids })
  let resume = ctx.afterSeq ?? 0
  let rebackfills = 0
  // The archive has no server-side kinds filter (unlike the live tail, which
  // sends `kinds=` on the wire), so filter client-side to make kinds uniform
  // across both phases. Only when non-empty: no kinds pays zero overhead.
  const kindsFilter =
    ctx.kinds && ctx.kinds.length > 0 ? new Set(ctx.kinds) : undefined

  for (;;) {
    // Backfill phase: page the sealed archive, pinning the tip from page 1.
    // A DownloadError re-plans the residual (lastEmitted, tip] (bounded by
    // maxRebackfills, shared with the live too-old guard); decode errors are
    // fatal. Uses its own backfillResume so the live phase's resume is
    // untouched.
    let sealedTip: number | undefined
    let backfillResume = resume
    let lastEmitted = resume
    for (;;) {
      try {
        for await (const page of planPages({
          host: ctx.host,
          dids: ctx.dids,
          collections: ctx.nsids,
          afterSeq: backfillResume,
          beforeSeq: ctx.beforeSeq,
          fetchImpl: ctx.fetchImpl,
          signal: ctx.signal,
        })) {
          sealedTip = page.sealedTipSeq
          for await (const batch of backfillBatches({
            host: ctx.host,
            entries: page.segments,
            selector,
            outstandingHwmBytes: ctx.outstandingHwmBytes,
            tailHwmBytes: ctx.tailHwmBytes,
            blockConcurrency: ctx.blockConcurrency,
            fetchImpl: ctx.fetchImpl,
            decompressor: ctx.decompressor,
            sha256: ctx.sha256,
            signal: ctx.signal,
            retry: ctx.retry,
            validateWire: ctx.validateWire,
          })) {
            if (batch.lastCursor > lastEmitted) lastEmitted = batch.lastCursor
            // lastCursor is preserved even when events were pruned: the
            // watermark must advance past filtered events, so an
            // empty-after-filter batch still yields.
            yield kindsFilter
              ? {
                  events: batch.events.filter((e) => kindsFilter.has(e.kind)),
                  lastCursor: batch.lastCursor,
                }
              : batch
          }
        }
        break
      } catch (err) {
        if (ctx.signal?.aborted) return
        if (!(err instanceof DownloadError)) throw err
        ctx.onError?.(err)
        const prev = backfillResume
        backfillResume = Math.max(lastEmitted, backfillResume)
        rebackfills++
        // Anti-spin bounded by maxRebackfills only: a transient failure
        // before any batch keeps backfillResume pinned, so keying on
        // resume-not-advancing would defeat fail-once-at-start recovery.
        if (rebackfills > maxRebackfills) {
          throw new Error(
            `jetstream: backfill re-plan made no progress (resume=${backfillResume} prev=${prev} cycles=${rebackfills})`,
            { cause: err },
          )
        }
      }
    }

    // Live phase: tail once at cursor = max(tip, resume), dedup the overlap.
    const cutover = Math.max(sealedTip ?? 0, resume)
    // dedupFloor drops seq <= floor. With an empty archive (cutover 0) the
    // floor must be undefined so live keeps every seq; otherwise drop the
    // <= tip overlap (the wire cursor is inclusive).
    const dedupFloor = cutover === 0 ? undefined : cutover
    let lastDelivered: number | undefined

    try {
      // Trivial single-event "batches" with no buffering — a size-N batcher
      // stalls on low-throughput streams (see Jetstream.liveRawBatches).
      for await (const ev of liveEvents({
        host: ctx.host,
        collections: ctx.nsids,
        dids: ctx.dids,
        kinds: ctx.kinds,
        cursor: cutover,
        dedupFloor,
        transport: ctx.transport,
        signal: ctx.signal,
        onError: ctx.onLiveError,
        validateWire: ctx.validateWire,
      })) {
        lastDelivered = ev.seq
        yield { events: [ev], lastCursor: ev.seq }
      }
      return // transport ended cleanly / signal abort
    } catch (err) {
      if (!isCursorTooOld(err)) throw err
      const prevResume = resume
      resume = Math.max(lastDelivered ?? cutover, cutover)
      rebackfills++
      if (rebackfills > maxRebackfills || resume <= prevResume) {
        throw new Error(
          `jetstream: re-backfill made no progress (resume=${resume} prev=${prevResume} cycles=${rebackfills})`,
          { cause: err },
        )
      }
      // loop: re-sweep from resume, reconnect
    }
  }
}
