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
import type * as ChatBskyActorDefs from '../actor/defs.js'
import type * as ChatBskyConvoDefs from '../convo/defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'chat.bsky.group.defs'

export type LinkEnabledStatus = 'enabled' | 'disabled' | (string & {})
export type JoinRule = 'anyone' | 'followedByOwner' | (string & {})

/** Join link view to be used within a group view, so the convo is surrounding, not specified inside this view. */
export interface JoinLinkView {
  $type?: 'chat.bsky.group.defs#joinLinkView'
  code: string
  enabledStatus: LinkEnabledStatus
  requireApproval: boolean
  joinRule: JoinRule
  createdAt: string
}

const hashJoinLinkView = 'joinLinkView'

export function isJoinLinkView<V>(v: V) {
  return is$typed(v, id, hashJoinLinkView)
}

export function validateJoinLinkView<V>(v: V) {
  return validate<JoinLinkView & V>(v, id, hashJoinLinkView)
}

/** Preview that can be shown in feeds, including to unauthenticated viewers. */
export interface JoinLinkPreviewView {
  $type?: 'chat.bsky.group.defs#joinLinkPreviewView'
  convoId: string
  code: string
  name: string
  owner: ChatBskyActorDefs.ProfileViewBasic
  memberCount: number
  memberLimit: number
  requireApproval: boolean
  joinRule: JoinRule
  convo?: ChatBskyConvoDefs.ConvoView
  viewer?: JoinLinkViewerState
}

const hashJoinLinkPreviewView = 'joinLinkPreviewView'

export function isJoinLinkPreviewView<V>(v: V) {
  return is$typed(v, id, hashJoinLinkPreviewView)
}

export function validateJoinLinkPreviewView<V>(v: V) {
  return validate<JoinLinkPreviewView & V>(v, id, hashJoinLinkPreviewView)
}

/** Preview for a disabled join link. Carries only the code so clients can correlate with the input and render a disabled state. */
export interface DisabledJoinLinkPreviewView {
  $type?: 'chat.bsky.group.defs#disabledJoinLinkPreviewView'
  code: string
}

const hashDisabledJoinLinkPreviewView = 'disabledJoinLinkPreviewView'

export function isDisabledJoinLinkPreviewView<V>(v: V) {
  return is$typed(v, id, hashDisabledJoinLinkPreviewView)
}

export function validateDisabledJoinLinkPreviewView<V>(v: V) {
  return validate<DisabledJoinLinkPreviewView & V>(
    v,
    id,
    hashDisabledJoinLinkPreviewView,
  )
}

/** Preview for a join link code that does not map to an existing link. Carries only the code so clients can correlate with the input and render an invalid state. */
export interface InvalidJoinLinkPreviewView {
  $type?: 'chat.bsky.group.defs#invalidJoinLinkPreviewView'
  code: string
}

const hashInvalidJoinLinkPreviewView = 'invalidJoinLinkPreviewView'

export function isInvalidJoinLinkPreviewView<V>(v: V) {
  return is$typed(v, id, hashInvalidJoinLinkPreviewView)
}

export function validateInvalidJoinLinkPreviewView<V>(v: V) {
  return validate<InvalidJoinLinkPreviewView & V>(
    v,
    id,
    hashInvalidJoinLinkPreviewView,
  )
}

export interface JoinLinkViewerState {
  $type?: 'chat.bsky.group.defs#joinLinkViewerState'
  requestedAt?: string
}

const hashJoinLinkViewerState = 'joinLinkViewerState'

export function isJoinLinkViewerState<V>(v: V) {
  return is$typed(v, id, hashJoinLinkViewerState)
}

export function validateJoinLinkViewerState<V>(v: V) {
  return validate<JoinLinkViewerState & V>(v, id, hashJoinLinkViewerState)
}

/** A join request from the perspective of the group owner. */
export interface JoinRequestView {
  $type?: 'chat.bsky.group.defs#joinRequestView'
  convoId: string
  requestedBy: ChatBskyActorDefs.ProfileViewBasic
  requestedAt: string
}

const hashJoinRequestView = 'joinRequestView'

export function isJoinRequestView<V>(v: V) {
  return is$typed(v, id, hashJoinRequestView)
}

export function validateJoinRequestView<V>(v: V) {
  return validate<JoinRequestView & V>(v, id, hashJoinRequestView)
}

/** A join request from the perspective of the requester, including enough group context to render the request in a list (e.g. group name, owner, member count). */
export interface JoinRequestConvoView {
  $type?: 'chat.bsky.group.defs#joinRequestConvoView'
  convoId: string
  name: string
  owner: ChatBskyActorDefs.ProfileViewBasic
  memberCount: number
  memberLimit: number
  viewer: JoinLinkViewerState
}

const hashJoinRequestConvoView = 'joinRequestConvoView'

export function isJoinRequestConvoView<V>(v: V) {
  return is$typed(v, id, hashJoinRequestConvoView)
}

export function validateJoinRequestConvoView<V>(v: V) {
  return validate<JoinRequestConvoView & V>(v, id, hashJoinRequestConvoView)
}
