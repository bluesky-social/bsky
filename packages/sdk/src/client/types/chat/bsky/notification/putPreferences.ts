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
import type * as ChatBskyNotificationDefs from './defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'chat.bsky.notification.putPreferences'

export type QueryParams = {}

export interface InputSchema {
  chat?: ChatBskyNotificationDefs.ChatPreference
  chatRequest?: ChatBskyNotificationDefs.ChatPreference
}

export interface OutputSchema {
  preferences: ChatBskyNotificationDefs.Preferences
}

export interface CallOptions {
  signal?: AbortSignal
  headers?: HeadersMap
  qp?: QueryParams
  encoding?: 'application/json'
}

export interface Response {
  success: boolean
  headers: HeadersMap
  data: OutputSchema
}

export function toKnownErr(e: any) {
  return e
}
