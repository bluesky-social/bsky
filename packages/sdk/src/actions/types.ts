import type { AtUriString } from '@atproto/syntax'
import type { app } from '../lexicons/index.js'
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
  updatedAt?: number
  [key: string]: unknown
}

export interface BskyPreferences {
  /** @deprecated use `savedFeeds` */
  feeds: {
    saved?: AtUriString[]
    pinned?: AtUriString[]
  }
  savedFeeds: app.bsky.actor.defs.SavedFeed[]
  feedViewPrefs: Record<string, BskyFeedViewPreference>
  threadViewPrefs: BskyThreadViewPreference
  moderationPrefs: ModerationPrefs
  birthDate: Date | undefined
  declaredAge?: app.bsky.actor.defs.DeclaredAgePref
  interests: BskyInterestsPreference
  bskyAppState: {
    queuedNudges: string[]
    activeProgressGuide: app.bsky.actor.defs.BskyAppProgressGuide | undefined
    nuxs: app.bsky.actor.defs.Nux[]
    isBetaUser?: boolean
  }
  postInteractionSettings: app.bsky.actor.defs.PostInteractionSettingsPref
  verificationPrefs: app.bsky.actor.defs.VerificationPrefs
  liveEventPreferences: {
    hiddenFeedIds: string[]
    hideAllFeeds: boolean
  }
}
