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
import type * as ChatBskyConvoDefs from '../convo/defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'chat.bsky.moderation.defs'

/** A view of a conversation for moderation purposes. Unlike chat.bsky.convo.defs#convoView, it does not include viewer-specific data (such as muted, unreadCount, status, lastMessage, lastReaction), since the requester is a moderator and not a member of the conversation. The member list is not included; use chat.bsky.moderation.getConvoMembers to list members. */
export interface ConvoView {
  $type?: 'chat.bsky.moderation.defs#convoView'
  id: string
  rev: string
  kind?: $Typed<DirectConvo> | $Typed<GroupConvo> | { $type: string }
}

const hashConvoView = 'convoView'

export function isConvoView<V>(v: V) {
  return is$typed(v, id, hashConvoView)
}

export function validateConvoView<V>(v: V) {
  return validate<ConvoView & V>(v, id, hashConvoView)
}

/** Data specific to a direct conversation, for moderation purposes. */
export interface DirectConvo {
  $type?: 'chat.bsky.moderation.defs#directConvo'
}

const hashDirectConvo = 'directConvo'

export function isDirectConvo<V>(v: V) {
  return is$typed(v, id, hashDirectConvo)
}

export function validateDirectConvo<V>(v: V) {
  return validate<DirectConvo & V>(v, id, hashDirectConvo)
}

/** Data specific to a group conversation, for moderation purposes. Unlike chat.bsky.convo.defs#groupConvo, it does not include viewer-specific data (such as unreadJoinRequestCount), since the requester is a moderator and not a member of the conversation. */
export interface GroupConvo {
  $type?: 'chat.bsky.moderation.defs#groupConvo'
  createdAt: string
  joinLink?: ChatBskyGroupDefs.JoinLinkView
  /** The total number of pending join requests for the group conversation. This information is only visible to the owner and to moderators. Capped at 21. */
  joinRequestCount: number
  lockStatus: ChatBskyConvoDefs.ConvoLockStatus
  /** The total number of members in the group conversation. */
  memberCount: number
  /** The maximum number of members allowed in the group conversation. */
  memberLimit: number
  /** The display name of the group conversation. */
  name: string
}

const hashGroupConvo = 'groupConvo'

export function isGroupConvo<V>(v: V) {
  return is$typed(v, id, hashGroupConvo)
}

export function validateGroupConvo<V>(v: V) {
  return validate<GroupConvo & V>(v, id, hashGroupConvo)
}
