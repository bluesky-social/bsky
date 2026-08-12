import { l, xrpc } from '@atproto/lex'
import { DownloadError } from './errors.js'
import {
  type RetryPolicy,
  type RetryTarget,
  abortableDelay,
  backoffDelay,
  isAbortError,
  isRetryableError,
  isRetryableStatus,
  parseRetryAfter,
  resolveRetry,
} from './retry.js'

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : undefined
}

const GET_SEGMENT_NSID = 'network.bsky.jetstream.getSegment'

// Hand-declared query defs (this package does not generate lexicon clients).
const getSegmentDef = l.query(
  GET_SEGMENT_NSID,
  l.params({ name: l.string() }),
  l.payload('application/octet-stream'),
  ['SegmentNotFound'],
)
const getBlockDef = l.query(
  'network.bsky.jetstream.getBlock',
  l.params({ segment: l.string(), blockIndex: l.integer({ minimum: 0 }) }),
  l.payload('application/octet-stream'),
  ['SegmentNotFound', 'BlockNotFound'],
)

function agent(host: string, fetchImpl: typeof fetch) {
  return { service: host, fetch: fetchImpl }
}

async function withRetry<T>(
  target: RetryTarget,
  signal: AbortSignal | undefined,
  retry: RetryPolicy | undefined,
  attemptFn: () => Promise<T>,
): Promise<T> {
  const policy = resolveRetry(retry)
  let attempt = 0
  for (;;) {
    attempt++
    try {
      return await attemptFn()
    } catch (err) {
      if (isAbortError(err)) throw err
      if (attempt >= policy.maxAttempts || !isRetryableError(err)) throw err
      const retryAfter = parseRetryAfter(
        (err as { headers?: Headers } | null)?.headers,
      )
      const delayMs = backoffDelay(attempt, policy, retryAfter)
      policy.onRetry?.(err instanceof Error ? err : new Error(String(err)), {
        attempt,
        delayMs,
        target,
      })
      await abortableDelay(delayMs, signal)
    }
  }
}

/** Buffered whole-segment download. The streaming path is streamSegment. */
export async function getSegment(
  host: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  retry?: RetryPolicy,
): Promise<Uint8Array> {
  try {
    return await withRetry(
      { kind: 'segment', name },
      signal,
      retry,
      async () => {
        const res = await xrpc(agent(host, fetchImpl), getSegmentDef, {
          params: { name },
          signal,
        })
        return res.body
      },
    )
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new DownloadError(`jetstream: getSegment ${name} failed`, {
      cause: err,
      status: statusOf(err),
    })
  }
}

/**
 * Streams a sealed segment's raw bytes. Bypasses the xrpc helper (which
 * buffers the whole body) and reads response.body directly so callers can
 * process frames as they arrive.
 */
export async function* streamSegment(
  host: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  retry?: RetryPolicy,
): AsyncGenerator<Uint8Array> {
  const url = new URL(`/xrpc/${GET_SEGMENT_NSID}`, host)
  url.searchParams.set('name', name)
  const policy = resolveRetry(retry)
  const target: RetryTarget = { kind: 'segment', name }

  // bytesYielded counts only bytes actually yielded downstream. A resume asks
  // for `bytes=${bytesYielded}-`; a 206 body continues exactly there, so the
  // concatenation of all yielded chunks equals the original byte stream. The
  // etag is the strong segment checksum from the initial 200; If-Range with
  // it makes a 206 prove the file is the same generation.
  let bytesYielded = 0
  let etag: string | undefined
  let attempt = 0

  async function notifyAndWait(
    err: unknown,
    attemptNum: number,
    headersForRetryAfter?: Headers,
  ): Promise<void> {
    const retryAfter = parseRetryAfter(headersForRetryAfter)
    const delayMs = backoffDelay(attemptNum, policy, retryAfter)
    policy.onRetry?.(err instanceof Error ? err : new Error(String(err)), {
      attempt: attemptNum,
      delayMs,
      target,
    })
    await abortableDelay(delayMs, signal)
  }

  for (;;) {
    attempt++
    const resuming = bytesYielded > 0
    const headers: Record<string, string> = {}
    if (resuming) {
      headers['Range'] = `bytes=${bytesYielded}-`
      // etag is always defined here: a mid-stream break with no captured etag
      // throws below rather than resuming (an unconditional Range could 206 a
      // rewritten file with shifted bytes — a silent splice).
      if (etag) headers['If-Range'] = etag
    }
    let res: Response
    try {
      res = await fetchImpl(url, {
        signal,
        headers: Object.keys(headers).length ? headers : undefined,
      })
    } catch (err) {
      // transport-level fetch rejection (connection refused/reset/DNS)
      if (isAbortError(err)) throw err
      if (attempt >= policy.maxAttempts || !isRetryableError(err)) {
        throw new DownloadError(`jetstream: getSegment ${name} failed`, {
          cause: err,
          status: statusOf(err),
        })
      }
      await notifyAndWait(err, attempt)
      continue
    }

    if (resuming) {
      // 206 = same generation, safe to continue. Anything else (200 = full
      // fresh body: ETag changed via compaction, or Range ignored) cannot be
      // spliced onto already-yielded bytes — drain and throw.
      if (res.status !== 206) {
        await res.body?.cancel()
        throw new DownloadError(
          `jetstream: getSegment ${name} resume returned HTTP ${res.status} (not 206); cannot splice`,
          { status: res.status },
        )
      }
      // The If-Range ETag proves same-generation, not same-offset: a range-
      // normalizing intermediary could 206 from the wrong start and silently
      // corrupt the splice. Trust only a Content-Range that starts exactly
      // where we left off.
      const contentRange = res.headers.get('content-range')
      const rangeStart = /^bytes (\d+)-/.exec(contentRange ?? '')?.[1]
      if (rangeStart === undefined || Number(rangeStart) !== bytesYielded) {
        await res.body?.cancel()
        throw new DownloadError(
          `jetstream: getSegment ${name} resume returned Content-Range ${JSON.stringify(contentRange)} (expected start ${bytesYielded}); cannot splice`,
          { status: res.status },
        )
      }
    } else {
      if (!res.ok) {
        // Drain the error body before throwing/retrying: an unconsumed body
        // keeps the undici socket checked out of the pool.
        await res.body?.cancel()
        if (attempt >= policy.maxAttempts || !isRetryableStatus(res.status)) {
          throw new DownloadError(
            `jetstream: getSegment ${name} failed: HTTP ${res.status}`,
            { status: res.status },
          )
        }
        await notifyAndWait(
          new DownloadError(`HTTP ${res.status}`, { status: res.status }),
          attempt,
          res.headers,
        )
        continue
      }
      etag = res.headers.get('etag') ?? undefined
    }

    if (!res.body) {
      throw new DownloadError(`jetstream: getSegment ${name} has no body`)
    }

    const reader = res.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) {
          reader.releaseLock()
          return // whole segment streamed
        }
        if (value && value.length) {
          bytesYielded += value.length
          yield value
        }
      }
    } catch (err) {
      // mid-stream break: reconnect with Range + If-Range on the next pass
      reader.releaseLock()
      if (isAbortError(err)) throw err
      // Without a captured etag there is no safe If-Range — refuse to resume.
      if (!etag || attempt >= policy.maxAttempts || !isRetryableError(err)) {
        throw new DownloadError(`jetstream: getSegment ${name} stream failed`, {
          cause: err,
        })
      }
      await notifyAndWait(err, attempt)
      continue
    }
  }
}

export async function getBlock(
  host: string,
  segment: string,
  blockIndex: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  retry?: RetryPolicy,
): Promise<Uint8Array> {
  try {
    return await withRetry(
      { kind: 'block', name: segment, blockIndex },
      signal,
      retry,
      async () => {
        const res = await xrpc(agent(host, fetchImpl), getBlockDef, {
          params: { segment, blockIndex },
          signal,
        })
        return res.body
      },
    )
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new DownloadError(
      `jetstream: getBlock ${segment}#${blockIndex} failed`,
      { cause: err, status: statusOf(err) },
    )
  }
}
