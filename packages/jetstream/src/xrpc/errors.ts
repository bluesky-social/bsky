import { type PlanEntry } from './plan.js'

/**
 * A recoverable download failure (network/transport error or transient HTTP
 * status) for a segment or block. Snapshot consumers catch this and recover
 * by re-planning the residual seq range; contrast MalformedError (corrupt
 * bytes), which is terminal. A plain Error, like MalformedError: this is a
 * client-side failure classification, not part of the lex/xrpc taxonomy.
 */
export class DownloadError extends Error {
  readonly entry?: PlanEntry
  readonly status?: number
  constructor(
    message: string,
    opts?: { entry?: PlanEntry; status?: number; cause?: unknown },
  ) {
    super(
      message,
      opts?.cause !== undefined ? { cause: opts.cause } : undefined,
    )
    this.name = 'DownloadError'
    this.entry = opts?.entry
    this.status = opts?.status
  }
}
