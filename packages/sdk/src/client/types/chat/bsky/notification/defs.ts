/**
 * GENERATED CODE - DO NOT MODIFY
 */
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
const id = 'chat.bsky.notification.defs'

export interface Preferences {
  $type?: 'chat.bsky.notification.defs#preferences'
  chat: ChatPreference
  chatRequest: ChatPreference
}

const hashPreferences = 'preferences'

export function isPreferences<V>(v: V) {
  return is$typed(v, id, hashPreferences)
}

export function validatePreferences<V>(v: V) {
  return validate<Preferences & V>(v, id, hashPreferences)
}

export interface ChatPreference {
  $type?: 'chat.bsky.notification.defs#chatPreference'
  include: 'all' | 'follows' | (string & {})
  push: boolean
}

const hashChatPreference = 'chatPreference'

export function isChatPreference<V>(v: V) {
  return is$typed(v, id, hashChatPreference)
}

export function validateChatPreference<V>(v: V) {
  return validate<ChatPreference & V>(v, id, hashChatPreference)
}
