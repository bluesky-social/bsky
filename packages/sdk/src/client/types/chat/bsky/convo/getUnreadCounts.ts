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

const is$typed = _is$typed,
  validate = _validate
const id = 'chat.bsky.convo.getUnreadCounts'

export type QueryParams = {
  /** When false, group convos are excluded from the counts. */
  includeGroupChats?: boolean
}
export type InputSchema = undefined

export interface OutputSchema {
  /** Number of unread, unlocked accepted convos. Counts convos with unread messages and unread join requests. Capped at 100, where 100 means more than 99. */
  unreadAcceptedConvos: number
  /** Number of unread, unlocked request convos. Includes convos with unread messages, but not with unread join request, since only the owner of a group has join requests to read, and the group would necessarily be accepted. Capped at 100, where 100 means more than 99. */
  unreadRequestConvos: number
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

export function toKnownErr(e: any) {
  return e
}
