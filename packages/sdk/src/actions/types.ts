import type { AtUriString, DatetimeString } from '@atproto/syntax'
import type {
  BskyAppProgressGuide,
  DeclaredAgePref,
  Nux,
  PostInteractionSettingsPref,
  SavedFeed,
  VerificationPrefs,
} from '../lexicons/app/bsky/actor/defs.defs.js'
import type { ModerationPrefs } from '../moderation/index.js'

export interface BskyFeedViewPreference {
  hideReplies: boolean
  hideRepliesByUnfollowed: boolean
  hideRepliesByLikeCount: number
  hideReposts: boolean
  hideQuotePosts: boolean
  lab_mergeFeedEnabled?: boolean
  [key: string]: unknown
}

export interface BskyThreadViewPreference {
  sort: string
  lab_treeViewEnabled?: boolean
  [key: string]: unknown
}

export interface BskyInterestsPreference {
  tags: string[]
  updatedAt?: DatetimeString
  [key: string]: unknown
}

export interface BskyPreferences {
  /** @deprecated use `savedFeeds` */
  feeds: {
    saved?: AtUriString[]
    pinned?: AtUriString[]
  }
  savedFeeds: SavedFeed[]
  feedViewPrefs: Record<string, BskyFeedViewPreference>
  threadViewPrefs: BskyThreadViewPreference
  moderationPrefs: ModerationPrefs
  birthDate: Date | undefined
  declaredAge?: DeclaredAgePref
  interests: BskyInterestsPreference
  bskyAppState: {
    queuedNudges: string[]
    activeProgressGuide: BskyAppProgressGuide | undefined
    nuxs: Nux[]
    isBetaUser?: boolean
  }
  postInteractionSettings: PostInteractionSettingsPref
  verificationPrefs: VerificationPrefs
  liveEventPreferences: {
    hiddenFeedIds: string[]
    hideAllFeeds: boolean
  }
}
