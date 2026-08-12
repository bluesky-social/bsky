import { type DidString } from '@atproto/lex'
import { backfillBatches } from '../engine/backfill-pipeline.js'
import { planPages } from '../engine/planner.js'
import { makeSelector } from '../engine/selector.js'
import { type EventBatch, type Kind, type RawEvent } from '../event.js'
import { type Decompressor, type Sha256 } from '../runtime/interface.js'
import { DownloadError } from '../xrpc/errors.js'
import { type RetryPolicy } from '../xrpc/retry.js'
import { liveEvents } from './source.js'
import {
  type LiveTransport,
  type LiveTransportHeaders,
  handshakeRejectionStatus,
} from './transport.js'

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
  headers?: LiveTransportHeaders // live handshake headers (e.g. Authorization)
  signal?: AbortSignal
  /** Recoverable problems from both phases, live-tail advisories included. */
  onError?: (err: Error) => void
  maxReplans?: number
  retry?: RetryPolicy
  validateWire?: boolean
}

// The server rejects a below-retention seq cursor pre-upgrade with an HTTP
// 400 whose body carries this stable marker.
const CURSOR_TOO_OLD = 'cursor too old'

// The default websocket transport cannot read the 400 body (ws discards it),
// so all it surfaces is the handshake status. Within the live phase of a
// cutover the params were just accepted by planSnapshot and only the cursor
// changes between connects, so a 400 handshake — exactly 400, never other
// 4xx — is classified as cursor-too-old and handed to the bounded
// re-backfill. A genuine bad-request 400 still terminates, after
// maxReplans instead of immediately. The message marker stays for custom
// transports that do surface the body.
//
// TODO: this status-based classification is a stopgap. Once ws-client can
// surface the handshake response body (see the HANDSHAKE_REJECTION_RE note in
// transport.ts), match the CursorTooOld error name precisely and drop the
// bare-400 heuristic.
function isCursorTooOld(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.message.includes(CURSOR_TOO_OLD)) return true
  return handshakeRejectionStatus(err) === 400
}

/**
 * Bufferless backfill→live cutover. Pages the sealed archive, then tails
 * subscribeEvents once at cursor = max(sealedTip, resume). A thrown "cursor
 * too old" 400 (backfill outran the live retention window) re-backfills from
 * the last delivered seq and reconnects, bounded by maxReplans with an
 * anti-spin guard. No client buffer or flip — the phases are sequential.
 */
export async function* cutoverReplay(
  ctx: CutoverParams,
): AsyncGenerator<EventBatch<RawEvent>> {
  if (ctx.signal?.aborted) return

  const maxReplans = ctx.maxReplans ?? 50
  let resume = ctx.afterSeq ?? 0
  let replans = 0
  // The seq window prunes rows from blocks that straddle a resume boundary
  // (the plan is one-sided at the seq level); its floor advances with each
  // re-plan/re-backfill so recovered sweeps never re-deliver.
  const window = { afterSeq: resume, beforeSeq: ctx.beforeSeq }
  const selector = makeSelector({
    dids: ctx.dids,
    collections: ctx.nsids,
    window,
  })
  // The archive has no server-side kinds filter (unlike the live tail, which
  // sends `kinds=` on the wire), so filter client-side to make kinds uniform
  // across both phases. Only when non-empty: no kinds pays zero overhead.
  const kindsFilter =
    ctx.kinds && ctx.kinds.length > 0 ? new Set(ctx.kinds) : undefined

  for (;;) {
    // Backfill phase: page the sealed archive, pinning the tip from page 1.
    // A DownloadError re-plans the residual (lastEmitted, tip] (bounded by
    // maxReplans, shared with the live too-old guard); decode errors are
    // fatal. Uses its own snapshotResume so the live phase's resume is
    // untouched.
    let sealedTip: number | undefined
    let snapshotResume = resume
    let lastEmitted = resume
    for (;;) {
      window.afterSeq = snapshotResume // sweep floor tracks the re-plan point
      try {
        for await (const page of planPages({
          host: ctx.host,
          dids: ctx.dids,
          collections: ctx.nsids,
          afterSeq: snapshotResume,
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
        const prev = snapshotResume
        snapshotResume = Math.max(lastEmitted, snapshotResume)
        replans++
        // Anti-spin bounded by maxReplans only: a transient failure
        // before any batch keeps snapshotResume pinned, so keying on
        // resume-not-advancing would defeat fail-once-at-start recovery.
        if (replans > maxReplans) {
          throw new Error(
            `jetstream: replay re-plan made no progress (resume=${snapshotResume} prev=${prev} cycles=${replans})`,
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
        headers: ctx.headers,
        signal: ctx.signal,
        onError: ctx.onError,
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
      replans++
      if (replans > maxReplans || resume <= prevResume) {
        throw new Error(
          `jetstream: replay re-plan made no progress (resume=${resume} prev=${prevResume} cycles=${replans})`,
          { cause: err },
        )
      }
      // loop: re-sweep from resume, reconnect
    }
  }
}
