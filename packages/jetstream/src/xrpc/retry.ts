import {
  RETRYABLE_HTTP_STATUS_CODES,
  XrpcFetchError,
  XrpcResponseError,
} from '@atproto/lex'

export type RetryTarget =
  | { kind: 'segment'; name: string }
  | { kind: 'block'; name: string; blockIndex: number }

export interface RetryInfo {
  attempt: number
  delayMs: number
  target: RetryTarget
}

export interface RetryPolicy {
  /** Defaults to Infinity — keep retrying transient failures until abort. */
  maxAttempts?: number
  /** Defaults to 250. */
  baseDelayMs?: number
  /** Defaults to 30_000. */
  maxDelayMs?: number
  onRetry?: (err: Error, info: RetryInfo) => void
}

export interface ResolvedRetry {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  onRetry?: (err: Error, info: RetryInfo) => void
}

export function resolveRetry(policy?: RetryPolicy): ResolvedRetry {
  return {
    maxAttempts: policy?.maxAttempts ?? Infinity,
    baseDelayMs: policy?.baseDelayMs ?? 250,
    maxDelayMs: policy?.maxDelayMs ?? 30_000,
    onRetry: policy?.onRetry,
  }
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status !== undefined && RETRYABLE_HTTP_STATUS_CODES.has(status)
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : undefined
}

/**
 * A download failure is retryable if it is a transport error (XrpcFetchError,
 * or a generic non-abort rejection on the streaming path) OR carries a
 * transient HTTP status. Aborts and non-retryable statuses (400/404/416…) are
 * not retryable.
 */
export function isRetryableError(err: unknown): boolean {
  if (isAbortError(err)) return false
  if (err instanceof XrpcFetchError) return true
  // An xrpc response error knows its own retryability — defer to it. The
  // status-set path below stays for the streaming layer, which classifies a
  // raw res.status rather than an XrpcResponseError.
  if (err instanceof XrpcResponseError) return err.shouldRetry()
  const status = statusOf(err)
  if (status !== undefined) return isRetryableStatus(status)
  // A non-abort Error with no status is a transport-level failure
  // (connection refused/reset/timeout/DNS) — retryable.
  return err instanceof Error
}

export function parseRetryAfter(
  headers: Headers | undefined,
): number | undefined {
  const raw = headers?.get('retry-after')
  if (!raw) return undefined
  const secs = Number(raw)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const when = Date.parse(raw)
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now())
  return undefined
}

/** Full-jitter exponential backoff; Retry-After (capped) wins when present. */
export function backoffDelay(
  attempt: number,
  policy: ResolvedRetry,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined)
    return Math.min(policy.maxDelayMs, retryAfterMs)
  const ceil = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  )
  return Math.random() * ceil
}

export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('aborted'))
  }
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
