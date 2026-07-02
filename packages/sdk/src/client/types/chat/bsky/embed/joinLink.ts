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
import type * as ChatBskyGroupDefs from '../group/defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'chat.bsky.embed.joinLink'

export interface Main {
  $type?: 'chat.bsky.embed.joinLink'
  /** The join link code. */
  code: string
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain)
}

export interface View {
  $type?: 'chat.bsky.embed.joinLink#view'
  joinLinkPreview:
    | $Typed<ChatBskyGroupDefs.JoinLinkPreviewView>
    | $Typed<ChatBskyGroupDefs.DisabledJoinLinkPreviewView>
    | $Typed<ChatBskyGroupDefs.InvalidJoinLinkPreviewView>
    | { $type: string }
}

const hashView = 'view'

export function isView<V>(v: V) {
  return is$typed(v, id, hashView)
}

export function validateView<V>(v: V) {
  return validate<View & V>(v, id, hashView)
}
