import type { app, chat, com } from '../lexicons/index.js'
import { KnownLabelValue } from './const/labels.js'
import { MuteWordMatch } from './mutewords.js'

// syntax
// =

export const CUSTOM_LABEL_VALUE_RE = /^[a-z-]+$/

// behaviors
// =

export interface ModerationBehavior {
  profileList?: 'blur' | 'alert' | 'inform'
  profileView?: 'blur' | 'alert' | 'inform'
  avatar?: 'blur' | 'alert'
  banner?: 'blur'
  displayName?: 'blur'
  contentList?: 'blur' | 'alert' | 'inform'
  contentView?: 'blur' | 'alert' | 'inform'
  contentMedia?: 'blur'
}
export const BLOCK_BEHAVIOR: ModerationBehavior = {
  profileList: 'blur',
  profileView: 'alert',
  avatar: 'blur',
  banner: 'blur',
  contentList: 'blur',
  contentView: 'blur',
}
export const MUTE_BEHAVIOR: ModerationBehavior = {
  profileList: 'inform',
  profileView: 'alert',
  contentList: 'blur',
  contentView: 'inform',
}
export const MUTEWORD_BEHAVIOR: ModerationBehavior = {
  contentList: 'blur',
  contentView: 'blur',
}
export const HIDE_BEHAVIOR: ModerationBehavior = {
  contentList: 'blur',
  contentView: 'blur',
}
export const NOOP_BEHAVIOR: ModerationBehavior = {}

// labels
// =

export type Label = com.atproto.label.defs.Label
export type LabelTarget = 'account' | 'profile' | 'content'
export type LabelPreference = 'ignore' | 'warn' | 'hide'

export type LabelValueDefinitionFlag =
  'no-override' | 'adult' | 'unauthed' | 'no-self'

export interface InterpretedLabelValueDefinition
  extends com.atproto.label.defs.LabelValueDefinition {
  definedBy?: string | undefined // did of labeler or undefined for global
  configurable: boolean
  defaultSetting: LabelPreference // type narrowing
  flags: LabelValueDefinitionFlag[]
  behaviors: {
    account?: ModerationBehavior
    profile?: ModerationBehavior
    content?: ModerationBehavior
  }
}

export type LabelDefinitionMap = Record<
  KnownLabelValue,
  InterpretedLabelValueDefinition
>

// subjects
// =

export type ModerationSubjectProfile =
  | app.bsky.actor.defs.ProfileViewBasic
  | app.bsky.actor.defs.ProfileView
  | app.bsky.actor.defs.ProfileViewDetailed
  | chat.bsky.actor.defs.ProfileViewBasic

export type ModerationSubjectPost = app.bsky.feed.defs.PostView

export type ModerationSubjectNotification =
  app.bsky.notification.listNotifications.Notification

export type ModerationSubjectFeedGenerator = app.bsky.feed.defs.GeneratorView

export type ModerationSubjectUserList =
  app.bsky.graph.defs.ListViewBasic | app.bsky.graph.defs.ListView

export type ModerationSubject =
  | ModerationSubjectProfile
  | ModerationSubjectPost
  | ModerationSubjectNotification
  | ModerationSubjectFeedGenerator
  | ModerationSubjectUserList

// behaviors
// =

export type ModerationCauseSource =
  | { type: 'user' }
  | { type: 'list'; list: app.bsky.graph.defs.ListViewBasic }
  | { type: 'labeler'; did: string }

export type ModerationCause =
  | {
      type: 'blocking'
      source: ModerationCauseSource
      priority: 3
      downgraded?: boolean
    }
  | {
      type: 'blocked-by'
      source: ModerationCauseSource
      priority: 4
      downgraded?: boolean
    }
  | {
      type: 'block-other'
      source: ModerationCauseSource
      priority: 4
      downgraded?: boolean
    }
  | {
      type: 'label'
      source: ModerationCauseSource
      label: Label
      labelDef: InterpretedLabelValueDefinition
      target: LabelTarget
      setting: LabelPreference
      behavior: ModerationBehavior
      noOverride: boolean
      priority: 1 | 2 | 5 | 7 | 8
      downgraded?: boolean
    }
  | {
      type: 'muted'
      source: ModerationCauseSource
      priority: 6
      downgraded?: boolean
    }
  | {
      type: 'mute-word'
      source: ModerationCauseSource
      priority: 6
      downgraded?: boolean
      matches: MuteWordMatch[]
    }
  | {
      type: 'hidden'
      source: ModerationCauseSource
      priority: 6
      downgraded?: boolean
    }

export interface ModerationPrefsLabeler {
  did: string
  labels: Record<string, LabelPreference>
}

export interface ModerationPrefs {
  adultContentEnabled: boolean
  labels: Record<string, LabelPreference>
  labelers: ModerationPrefsLabeler[]
  mutedWords: app.bsky.actor.defs.MutedWord[]
  hiddenPosts: string[]
}

export interface ModerationOpts {
  userDid: string | undefined
  prefs: ModerationPrefs
  /**
   * Map of labeler did -> custom definitions
   */
  labelDefs?: Record<string, InterpretedLabelValueDefinition[]>
}
