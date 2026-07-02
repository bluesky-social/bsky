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
const id = 'chat.bsky.actor.getStatus'

export type QueryParams = {}
export type InputSchema = undefined

export interface OutputSchema {
  /** True when the viewer's account is disabled and cannot actively participate in chat. */
  chatDisabled: boolean
  /** Whether the viewer's account is allowed to create group chats. New accounts are restricted from creating groups. */
  canCreateGroups: boolean
  /** The maximum number of members allowed in a group conversation. */
  groupMemberLimit: number
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
