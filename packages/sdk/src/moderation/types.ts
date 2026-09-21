import type { AtUriString, DidString } from '@atproto/syntax'
import type {
  MutedWord,
  ProfileView,
  ProfileViewBasic,
  ProfileViewDetailed,
} from '../lexicons/app/bsky/actor/defs.defs.js'
import type {
  GeneratorView,
  PostView,
} from '../lexicons/app/bsky/feed/defs.defs.js'
import type {
  ListView,
  ListViewBasic,
} from '../lexicons/app/bsky/graph/defs.defs.js'
import type { Notification } from '../lexicons/app/bsky/notification/listNotifications.defs.js'
import type { ProfileViewBasic as ChatProfileViewBasic } from '../lexicons/chat/bsky/actor/defs.defs.js'
import type {
  Label as ComAtprotoLabel,
  LabelValueDefinition,
} from '../lexicons/com/atproto/label/defs.defs.js'
import { type KnownLabelValue } from './const/labels.js'
import { type MuteWordMatch } from './mutewords.js'

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

export type Label = ComAtprotoLabel
export type LabelTarget = 'account' | 'profile' | 'content'
export type LabelPreference = 'ignore' | 'warn' | 'hide'

export type LabelValueDefinitionFlag =
  'no-override' | 'adult' | 'unauthed' | 'no-self'

export interface InterpretedLabelValueDefinition extends LabelValueDefinition {
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
  ProfileViewBasic | ProfileView | ProfileViewDetailed | ChatProfileViewBasic

export type ModerationSubjectPost = PostView

export type ModerationSubjectNotification = Notification

export type ModerationSubjectFeedGenerator = GeneratorView

export type ModerationSubjectUserList = ListViewBasic | ListView

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
  | { type: 'list'; list: ListViewBasic }
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
  did: DidString
  labels: Record<string, LabelPreference>
}

export interface ModerationPrefs {
  adultContentEnabled: boolean
  labels: Record<string, LabelPreference>
  labelers: ModerationPrefsLabeler[]
  mutedWords: MutedWord[]
  hiddenPosts: AtUriString[]
}

export interface ModerationOpts {
  userDid: DidString | undefined
  prefs: ModerationPrefs
  /**
   * Map of labeler did -> custom definitions
   */
  labelDefs?: Record<string, InterpretedLabelValueDefinition[]>
}
