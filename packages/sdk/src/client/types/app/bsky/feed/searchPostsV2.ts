/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { HeadersMap, XRPCError } from '@atproto/xrpc'
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util.js'
import type * as AppBskyFeedDefs from './defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.bsky.feed.searchPostsV2'

export type QueryParams = {
  /** Optional pagination cursor. */
  cursor?: string
  /** Maximum number of results to return. */
  limit?: number
  /** Search query string. A query or at least one filter is required. */
  query?: string
  /** Ranking order for results. 'recent' sorts by recency; 'top' uses search ranking. */
  sort?: 'recent' | 'top' | (string & {})
  /** Include posts by any of these authors. Handles are resolved to DIDs before searching. */
  authors?: string[]
  /** Include posts that mention any of these accounts. Handles are resolved to DIDs before searching. */
  mentions?: string[]
  /** Include posts that link to any of these domains. */
  domains?: string[]
  /** Include posts that link to any of these URLs. */
  urls?: string[]
  /** Include posts that embed any of these AT URIs. */
  embeddedAtUris?: string[]
  /** Include posts tagged with any of these hashtags. Do not include the hash (#) prefix. */
  hashtags?: string[]
  /** Exclude posts by any of these authors. Handles are resolved to DIDs before searching. */
  excludeAuthors?: string[]
  /** Exclude posts that mention any of these accounts. Handles are resolved to DIDs before searching. */
  excludeMentions?: string[]
  /** Exclude posts that link to any of these domains. */
  excludeDomains?: string[]
  /** Exclude posts that link to any of these URLs. */
  excludeUrls?: string[]
  /** Exclude posts that embed any of these AT URIs. */
  excludeEmbeddedAtUris?: string[]
  /** Exclude posts tagged with any of these hashtags. Do not include the hash (#) prefix. */
  excludeHashtags?: string[]
  /** Include posts indexed at or after this timestamp. Can be a datetime, or just an ISO date (YYYY-MM-DD). */
  since?: string
  /** Include posts indexed before this timestamp. Defaults to the current time. Can be a datetime, or just an ISO date (YYYY-MM-DD). */
  until?: string
  /** Search the full index instead of the recent-post window. */
  allTime?: boolean
  /** Include posts whose language matches any of these language codes. */
  languages?: string[]
  /** Exclude posts whose language matches any of these language codes. */
  excludeLanguages?: string[]
  /** Include only posts with media. */
  hasMedia?: boolean
  /** Include only posts with video. */
  hasVideo?: boolean
  /** Include only direct replies to this parent post URI. */
  replyParentUri?: string
  /** Include only posts in the thread rooted at this post URI. */
  threadRootUri?: string
  /** Exclude replies from results. Mutually exclusive with repliesOnly. */
  excludeReplies?: boolean
  /** Include only replies. Mutually exclusive with excludeReplies. */
  repliesOnly?: boolean
  /** Include only posts from accounts followed by the viewer. */
  following?: boolean
  /** Language analyzer hint for the query text. If unset, the server auto-detects when possible. */
  queryLanguage?: 'ja' | 'zh' | 'ko' | 'th' | 'ar' | (string & {})
}
export type InputSchema = undefined

export interface OutputSchema {
  /** Cursor for the next page of results. */
  cursor?: string
  /** Estimated total number of matching hits. May be rounded or truncated. */
  hitsTotal?: number
  /** Hydrated views of matching posts. */
  posts: AppBskyFeedDefs.PostView[]
  /** Query languages detected for CJK, Thai, or Arabic text. Empty or omitted for other scripts. */
  detectedQueryLanguages?: ('ja' | 'zh' | 'ko' | 'th' | 'ar' | (string & {}))[]
}

export interface CallOptions {
  signal?: AbortSignal
  headers?: HeadersMap
}

export interface Response {
  success: boolean
  headers: HeadersMap
  data: OutputSchema
}

export class BadQueryStringError extends XRPCError {
  constructor(src: XRPCError) {
    super(src.status, src.error, src.message, src.headers, { cause: src })
  }
}

export function toKnownErr(e: any) {
  if (e instanceof XRPCError) {
    if (e.error === 'BadQueryString') return new BadQueryStringError(e)
  }

  return e
}
