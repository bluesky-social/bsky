import { type Action, Client } from '@atproto/lex-client'
import type { AtUriString } from '@atproto/syntax'
import { AtUri, ensureValidDidRegex, toDatetimeString } from '@atproto/syntax'
import {
  adultContentPref,
  bskyAppStatePref,
  contentLabelPref,
  declaredAgePref,
  feedViewPref,
  hiddenPostsPref,
  interestsPref,
  labelersPref,
  liveEventPreferences,
  mutedWordsPref,
  personalDetailsPref,
  postInteractionSettingsPref,
  savedFeedsPref,
  savedFeedsPrefV2,
  threadViewPref,
  verificationPrefs,
} from '../lexicons/app/bsky/actor/defs.defs.js'
import type { app } from '../lexicons/index.js'
import { app as appLexicons } from '../lexicons/index.js'
import type { LabelPreference } from '../moderation/index.js'
import { DEFAULT_LABEL_SETTINGS } from '../moderation/index.js'
import { sanitizeMutedWordValue, validateNux } from '../utils/index.js'
import type {
  BskyFeedViewPreference,
  BskyPreferences,
  BskyThreadViewPreference,
} from './types.js'

type Preferences = app.bsky.actor.defs.Preferences
type SavedFeed = app.bsky.actor.defs.SavedFeed

/**
 * TID generator replacing TID.nextStr() from @atproto/common-web (no longer a dependency).
 * Produces unique, roughly-sortable base-32 string IDs using millisecond timestamp * 1000 + counter.
 */
let _tidCounter = 0
function nextTid(): string {
  const ts = Date.now() * 1000 + (_tidCounter++ % 1000)
  return ts.toString(32).padStart(13, '0')
}

// Label name remapping for legacy label names
const LABEL_REMAP: Record<string, string> = {
  nsfw: 'porn',
  gore: 'graphic-media',
  suggestive: 'sexual',
}

// Reverse remap for double-writing
const LABEL_REMAP_REVERSE: Record<string, string[]> = {
  porn: ['nsfw'],
  'graphic-media': ['gore'],
  sexual: ['suggestive'],
}

function getSavedFeedType(
  uri: string,
): 'feed' | 'list' | 'timeline' | undefined {
  if (uri === 'following') return 'timeline'
  try {
    const parsed = new AtUri(uri)
    if (parsed.collection === 'app.bsky.feed.generator') return 'feed'
    if (parsed.collection === 'app.bsky.graph.list') return 'list'
  } catch {
    // ignore
  }
  return undefined
}

function validateSavedFeed(feed: SavedFeed): void {
  if (!feed.id) {
    throw new Error('Saved feed must have an `id` - use a TID')
  }
  if (['feed', 'list'].includes(feed.type)) {
    const uri = new AtUri(feed.value)
    if (feed.type === 'feed' && uri.collection !== 'app.bsky.feed.generator') {
      throw new Error(
        `Saved feed of type 'feed' must be a feed, got ${uri.collection}`,
      )
    }
    if (feed.type === 'list' && uri.collection !== 'app.bsky.graph.list') {
      throw new Error(
        `Saved feed of type 'list' must be a list, got ${uri.collection}`,
      )
    }
  }
}

/**
 * Low-level helper to update the raw preferences array on the server.
 *
 * Callers are responsible for sequencing concurrent calls to avoid write conflicts.
 */
export const updatePreferences: Action<
  (prefs: Preferences) => Preferences | false,
  Preferences
> = async (client, cb) => {
  const res = await client.xrpc(appLexicons.bsky.actor.getPreferences.main, {
    params: {},
  })
  const current = res.body.preferences as Preferences
  const result = cb(current)
  if (result === false) return current
  await client.xrpc(appLexicons.bsky.actor.putPreferences.main, {
    body: { preferences: result },
  })
  return result
}

/**
 * Fetches and interprets the current user's preferences into a structured BskyPreferences object.
 * Migrates v1 savedFeeds to v2 on first read.
 */
export const getPreferences: Action<void, BskyPreferences> = async (client) => {
  const res = await client.xrpc(appLexicons.bsky.actor.getPreferences.main, {
    params: {},
  })
  let prefs = res.body.preferences as Preferences

  // Migrate v1 saved feeds to v2 if needed
  const hasV2 = prefs.some((p) => p.$type === savedFeedsPrefV2.$type)
  const v1 = prefs.find((p) => p.$type === savedFeedsPref.$type) as
    app.bsky.actor.defs.SavedFeedsPref | undefined

  if (!hasV2 && v1) {
    // Migrate: convert v1 to v2
    // Use a Map keyed by a unique key to deduplicate and preserve order
    const uniqueMigratedSavedFeeds = new Map<string, SavedFeed>()

    // Insert Following feed first (old agent.ts ~697-712)
    uniqueMigratedSavedFeeds.set('timeline', {
      id: nextTid(),
      type: 'timeline',
      value: 'following',
      pinned: true,
    })

    // Use pinned as source of truth for feed order
    for (const uri of v1.pinned) {
      const type = getSavedFeedType(uri)
      if (type === undefined || type === 'timeline') continue
      uniqueMigratedSavedFeeds.set(uri, {
        id: nextTid(),
        type,
        value: uri,
        pinned: true,
      })
    }

    // Add saved-only feeds (not already in pinned)
    for (const uri of v1.saved) {
      if (!uniqueMigratedSavedFeeds.has(uri)) {
        const type = getSavedFeedType(uri)
        if (type === undefined || type === 'timeline') continue
        uniqueMigratedSavedFeeds.set(uri, {
          id: nextTid(),
          type,
          value: uri,
          pinned: false,
        })
      }
    }

    const v2Items = Array.from(uniqueMigratedSavedFeeds.values())
    const newPrefs: Preferences = [
      ...prefs.filter((p) => p.$type !== savedFeedsPref.$type),
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: v2Items,
      } as app.bsky.actor.defs.SavedFeedsPrefV2 & {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2'
      },
    ]
    await client.xrpc(appLexicons.bsky.actor.putPreferences.main, {
      body: { preferences: newPrefs },
    })
    prefs = newPrefs
  } else if (!hasV2) {
    // No v1 either, add a default timeline feed
    const defaultTimeline: SavedFeed = {
      id: nextTid(),
      type: 'timeline',
      value: 'following',
      pinned: true,
    }
    const newPrefs: Preferences = [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: [defaultTimeline],
      } as app.bsky.actor.defs.SavedFeedsPrefV2 & {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2'
      },
    ]
    await client.xrpc(appLexicons.bsky.actor.putPreferences.main, {
      body: { preferences: newPrefs },
    })
    prefs = newPrefs
  }

  // Parse out each pref type
  const adultContent = prefs.find((p) => p.$type === adultContentPref.$type) as
    app.bsky.actor.defs.AdultContentPref | undefined
  const personalDetails = prefs.find(
    (p) => p.$type === personalDetailsPref.$type,
  ) as app.bsky.actor.defs.PersonalDetailsPref | undefined
  const declaredAge = prefs.find((p) => p.$type === declaredAgePref.$type) as
    app.bsky.actor.defs.DeclaredAgePref | undefined
  const labelPrefs = prefs.filter(
    (p) => p.$type === contentLabelPref.$type,
  ) as app.bsky.actor.defs.ContentLabelPref[]
  const feedViewPrefsArr = prefs.filter(
    (p) => p.$type === feedViewPref.$type,
  ) as app.bsky.actor.defs.FeedViewPref[]
  const threadView = prefs.find((p) => p.$type === threadViewPref.$type) as
    app.bsky.actor.defs.ThreadViewPref | undefined
  const interests = prefs.find((p) => p.$type === interestsPref.$type) as
    app.bsky.actor.defs.InterestsPref | undefined
  const mutedWords = prefs.find((p) => p.$type === mutedWordsPref.$type) as
    app.bsky.actor.defs.MutedWordsPref | undefined
  const hiddenPosts = prefs.find((p) => p.$type === hiddenPostsPref.$type) as
    app.bsky.actor.defs.HiddenPostsPref | undefined
  const labelersP = prefs.find((p) => p.$type === labelersPref.$type) as
    app.bsky.actor.defs.LabelersPref | undefined
  const bskyAppState = prefs.find((p) => p.$type === bskyAppStatePref.$type) as
    app.bsky.actor.defs.BskyAppStatePref | undefined
  const postInteraction = prefs.find(
    (p) => p.$type === postInteractionSettingsPref.$type,
  ) as app.bsky.actor.defs.PostInteractionSettingsPref | undefined
  const verificationP = prefs.find(
    (p) => p.$type === verificationPrefs.$type,
  ) as app.bsky.actor.defs.VerificationPrefs | undefined
  const liveEventP = prefs.find(
    (p) => p.$type === liveEventPreferences.$type,
  ) as app.bsky.actor.defs.LiveEventPreferences | undefined

  // v2 saved feeds
  const v2Pref = prefs.find((p) => p.$type === savedFeedsPrefV2.$type) as
    (app.bsky.actor.defs.SavedFeedsPrefV2 & { $type: string }) | undefined
  const savedFeeds: SavedFeed[] = v2Pref?.items ?? []

  // Legacy v1 arrays (deprecated)
  const v1Pref = prefs.find((p) => p.$type === savedFeedsPref.$type) as
    app.bsky.actor.defs.SavedFeedsPref | undefined
  const legacyFeeds = {
    saved: v1Pref?.saved,
    pinned: v1Pref?.pinned,
  }

  // Build labels record, seeding with DEFAULT_LABEL_SETTINGS first (old agent.ts:568)
  const labels: Record<string, LabelPreference> = { ...DEFAULT_LABEL_SETTINGS }
  for (const labelPref of labelPrefs) {
    if (labelPref.labelerDid) continue // skip labeler-specific prefs for global map
    let visibility = labelPref.visibility as LabelPreference | 'show'
    if (visibility === 'show') visibility = 'ignore'
    // remap legacy label names
    const mappedName = LABEL_REMAP[labelPref.label] ?? labelPref.label
    labels[mappedName] = visibility as LabelPreference
    // also set the original legacy name if it was remapped
    if (LABEL_REMAP[labelPref.label]) {
      labels[labelPref.label] = visibility as LabelPreference
    }
  }

  // Build feedViewPrefs
  const feedViewPrefs: Record<string, BskyFeedViewPreference> = {}
  for (const fvp of feedViewPrefsArr) {
    feedViewPrefs[fvp.feed] = {
      hideReplies: fvp.hideReplies ?? false,
      hideRepliesByUnfollowed: fvp.hideRepliesByUnfollowed ?? true,
      hideRepliesByLikeCount: fvp.hideRepliesByLikeCount ?? 0,
      hideReposts: fvp.hideReposts ?? false,
      hideQuotePosts: fvp.hideQuotePosts ?? false,
    }
  }
  // Always have 'home' defaults
  if (!feedViewPrefs.home) {
    feedViewPrefs.home = {
      hideReplies: false,
      hideRepliesByUnfollowed: true,
      hideRepliesByLikeCount: 0,
      hideReposts: false,
      hideQuotePosts: false,
    }
  }

  const threadViewPrefs: BskyThreadViewPreference = {
    sort: threadView?.sort ?? 'hotness',
  }

  // Build labelers list: app labelers + user's labeler prefs
  const appLabelerDids = Client.appLabelers
  const appLabelers = [...appLabelerDids].map((did) => ({
    did,
    labels: {} as Record<string, LabelPreference>,
  }))
  const userLabelers = (labelersP?.labelers ?? []).map((l) => ({
    did: l.did,
    labels: {} as Record<string, LabelPreference>,
  }))
  // Merge app labelers with user labelers (user labelers override or extend)
  const allLabelerDids = new Set([
    ...appLabelers.map((l) => l.did),
    ...userLabelers.map((l) => l.did),
  ])
  const mergedLabelers = [...allLabelerDids].map((did) => ({
    did,
    labels: {} as Record<string, LabelPreference>,
  }))

  // Apply labeler-specific label prefs
  for (const labelPref of labelPrefs) {
    if (!labelPref.labelerDid) continue
    const labelerEntry = mergedLabelers.find(
      (l) => l.did === labelPref.labelerDid,
    )
    if (labelerEntry) {
      let visibility = labelPref.visibility as LabelPreference | 'show'
      if (visibility === 'show') visibility = 'ignore'
      labelerEntry.labels[labelPref.label] = visibility as LabelPreference
    }
  }

  // Fix up mutedWords: default actorTarget to 'all' if not set (old agent.ts:648-651)
  const mutedWordItems = (mutedWords?.items ?? []).map((word) => ({
    ...word,
    actorTarget: word.actorTarget || 'all',
  }))

  return {
    feeds: legacyFeeds,
    savedFeeds,
    feedViewPrefs,
    threadViewPrefs,
    moderationPrefs: {
      adultContentEnabled: adultContent?.enabled ?? false,
      labels,
      labelers: mergedLabelers,
      mutedWords: mutedWordItems,
      hiddenPosts: hiddenPosts?.items ?? [],
    },
    birthDate: personalDetails?.birthDate
      ? new Date(personalDetails.birthDate)
      : undefined,
    declaredAge,
    interests: {
      tags: interests?.tags ?? [],
    },
    bskyAppState: {
      queuedNudges: bskyAppState?.queuedNudges ?? [],
      activeProgressGuide: bskyAppState?.activeProgressGuide,
      nuxs: bskyAppState?.nuxs ?? [],
    },
    postInteractionSettings: {
      threadgateAllowRules: postInteraction?.threadgateAllowRules,
      postgateEmbeddingRules: postInteraction?.postgateEmbeddingRules,
    },
    verificationPrefs: verificationP ?? { hideBadges: false },
    liveEventPreferences: {
      hiddenFeedIds: liveEventP?.hiddenFeedIds ?? [],
      hideAllFeeds: liveEventP?.hideAllFeeds ?? false,
    },
  }
}

export const setAdultContentEnabled: Action<boolean, void> = async (
  client,
  enabled,
) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === adultContentPref.$type)
    if (existing) {
      return prefs.map((p) =>
        p.$type === adultContentPref.$type ? { ...p, enabled } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#adultContentPref',
        enabled,
      } as app.bsky.actor.defs.AdultContentPref & {
        $type: 'app.bsky.actor.defs#adultContentPref'
      },
    ] as Preferences
  })
}

export const setContentLabelPref: Action<
  { key: string; value: LabelPreference; labelerDid?: string },
  void
> = async (client, { key, value, labelerDid }) => {
  // Validate labelerDid if provided (old agent.ts:895-897)
  if (labelerDid) {
    ensureValidDidRegex(labelerDid)
  }
  await client.call(updatePreferences, (prefs) => {
    // Remove existing pref for this key+labelerDid combo
    const filtered = prefs.filter((p) => {
      if (p.$type !== contentLabelPref.$type) return true
      const lp = p as app.bsky.actor.defs.ContentLabelPref
      return !(lp.label === key && lp.labelerDid === labelerDid)
    }) as Preferences

    // Add new pref for main key
    const newPrefs: Preferences = [
      ...filtered,
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: key,
        labelerDid,
        visibility: value,
      } as app.bsky.actor.defs.ContentLabelPref & {
        $type: 'app.bsky.actor.defs#contentLabelPref'
      },
    ]

    // Double-write for legacy label aliases ONLY when global (no labelerDid)
    // (old agent.ts:911-914: `if (!labelPref.labelerDid)`)
    if (!labelerDid) {
      const legacyAliases = LABEL_REMAP_REVERSE[key] ?? []
      for (const alias of legacyAliases) {
        // Remove existing legacy alias pref
        const withoutAlias = newPrefs.filter((p) => {
          if (p.$type !== contentLabelPref.$type) return true
          const lp = p as app.bsky.actor.defs.ContentLabelPref
          return !(lp.label === alias && lp.labelerDid === undefined)
        }) as Preferences
        newPrefs.length = 0
        newPrefs.push(...withoutAlias)
        newPrefs.push({
          $type: 'app.bsky.actor.defs#contentLabelPref',
          label: alias,
          labelerDid: undefined,
          visibility: value,
        } as app.bsky.actor.defs.ContentLabelPref & {
          $type: 'app.bsky.actor.defs#contentLabelPref'
        })
      }
    }

    return newPrefs
  })
}

export const addSavedFeeds: Action<
  Pick<SavedFeed, 'type' | 'value' | 'pinned'>[],
  SavedFeed[]
> = async (client, feeds) => {
  const newFeeds: SavedFeed[] = feeds.map((f) => ({ ...f, id: nextTid() }))
  newFeeds.forEach(validateSavedFeed)

  await client.call(updatePreferences, (prefs) => {
    const v2 = prefs.find((p) => p.$type === savedFeedsPrefV2.$type) as
      (app.bsky.actor.defs.SavedFeedsPrefV2 & { $type: string }) | undefined
    const currentItems = v2?.items ?? []
    const updatedItems = [...currentItems, ...newFeeds]

    if (v2) {
      return prefs.map((p) =>
        p.$type === savedFeedsPrefV2.$type ? { ...p, items: updatedItems } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: updatedItems,
      } as app.bsky.actor.defs.SavedFeedsPrefV2 & {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2'
      },
    ] as Preferences
  })

  return newFeeds
}

export const removeSavedFeeds: Action<string[], void> = async (client, ids) => {
  await client.call(updatePreferences, (prefs) => {
    const v2 = prefs.find((p) => p.$type === savedFeedsPrefV2.$type) as
      (app.bsky.actor.defs.SavedFeedsPrefV2 & { $type: string }) | undefined
    if (!v2) return false
    const updatedItems = v2.items.filter((f) => !ids.includes(f.id))
    return prefs.map((p) =>
      p.$type === savedFeedsPrefV2.$type ? { ...p, items: updatedItems } : p,
    ) as Preferences
  })
}

export const updateSavedFeeds: Action<SavedFeed[], void> = async (
  client,
  savedFeedsToUpdate,
) => {
  savedFeedsToUpdate.forEach(validateSavedFeed)
  await client.call(updatePreferences, (prefs) => {
    const v2 = prefs.find((p) => p.$type === savedFeedsPrefV2.$type) as
      (app.bsky.actor.defs.SavedFeedsPrefV2 & { $type: string }) | undefined
    if (!v2) return false
    const updatedItems = v2.items.map((savedFeed) => {
      const updatedVersion = savedFeedsToUpdate.find(
        (updated) => savedFeed.id === updated.id,
      )
      if (updatedVersion) {
        return {
          ...savedFeed,
          // only update pinned (old agent.ts:792-795)
          pinned: updatedVersion.pinned,
        }
      }
      return savedFeed
    })
    return prefs.map((p) =>
      p.$type === savedFeedsPrefV2.$type ? { ...p, items: updatedItems } : p,
    ) as Preferences
  })
}

export const overwriteSavedFeeds: Action<SavedFeed[], void> = async (
  client,
  feeds,
) => {
  await client.call(updatePreferences, (prefs) => {
    const hasV2 = prefs.some((p) => p.$type === savedFeedsPrefV2.$type)
    if (hasV2) {
      return prefs.map((p) =>
        p.$type === savedFeedsPrefV2.$type ? { ...p, items: feeds } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: feeds,
      } as app.bsky.actor.defs.SavedFeedsPrefV2 & {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2'
      },
    ] as Preferences
  })
}

/**
 * @deprecated use updateSavedFeeds or removeSavedFeeds
 * (old agent.ts:856-862 addPinnedFeed)
 */
export const addPinnedFeed: Action<string, void> = async (client, uri) => {
  await client.call(updatePreferences, (prefs) => {
    const feedsPref = prefs.find((p) => p.$type === savedFeedsPref.$type) as
      | (app.bsky.actor.defs.SavedFeedsPref & {
          $type: 'app.bsky.actor.defs#savedFeedsPref'
        })
      | undefined
    const currentSaved = feedsPref?.saved ?? []
    const currentPinned = feedsPref?.pinned ?? []
    const newSaved = [...currentSaved.filter((u) => u !== uri), uri]
    const newPinned = [...currentPinned.filter((u) => u !== uri), uri]
    if (feedsPref) {
      return prefs.map((p) =>
        p.$type === savedFeedsPref.$type
          ? { ...p, saved: newSaved, pinned: newPinned }
          : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#savedFeedsPref',
        saved: newSaved,
        pinned: newPinned,
      } as app.bsky.actor.defs.SavedFeedsPref & {
        $type: 'app.bsky.actor.defs#savedFeedsPref'
      },
    ] as Preferences
  })
}

/**
 * @deprecated use updateSavedFeeds or removeSavedFeeds
 * (old agent.ts:864-870 removePinnedFeed)
 */
export const removePinnedFeed: Action<string, void> = async (client, uri) => {
  await client.call(updatePreferences, (prefs) => {
    const feedsPref = prefs.find((p) => p.$type === savedFeedsPref.$type) as
      | (app.bsky.actor.defs.SavedFeedsPref & {
          $type: 'app.bsky.actor.defs#savedFeedsPref'
        })
      | undefined
    if (!feedsPref) return false
    const newPinned = feedsPref.pinned.filter((u) => u !== uri)
    return prefs.map((p) =>
      p.$type === savedFeedsPref.$type ? { ...p, pinned: newPinned } : p,
    ) as Preferences
  })
}

export const setFeedViewPrefs: Action<
  { feed: string } & Partial<BskyFeedViewPreference>,
  void
> = async (client, { feed, ...updates }) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find(
      (p) =>
        p.$type === feedViewPref.$type &&
        (p as app.bsky.actor.defs.FeedViewPref).feed === feed,
    ) as app.bsky.actor.defs.FeedViewPref | undefined

    const current: app.bsky.actor.defs.FeedViewPref = existing ?? {
      feed,
    }
    const updated = { ...current, ...updates }

    if (existing) {
      return prefs.map((p) =>
        p.$type === feedViewPref.$type &&
        (p as app.bsky.actor.defs.FeedViewPref).feed === feed
          ? updated
          : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#feedViewPref',
        ...updated,
      } as app.bsky.actor.defs.FeedViewPref & {
        $type: 'app.bsky.actor.defs#feedViewPref'
      },
    ] as Preferences
  })
}

export const setThreadViewPrefs: Action<
  Partial<BskyThreadViewPreference>,
  void
> = async (client, updates) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === threadViewPref.$type) as
      app.bsky.actor.defs.ThreadViewPref | undefined

    const updated = { ...(existing ?? {}), ...updates }

    if (existing) {
      return prefs.map((p) =>
        p.$type === threadViewPref.$type ? { ...p, ...updated } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#threadViewPref',
        ...updated,
      } as app.bsky.actor.defs.ThreadViewPref & {
        $type: 'app.bsky.actor.defs#threadViewPref'
      },
    ] as Preferences
  })
}

export const setPersonalDetails: Action<
  { birthDate: Date | string | undefined },
  void
> = async (client, { birthDate }) => {
  const birthDateStr =
    birthDate instanceof Date ? toDatetimeString(birthDate) : birthDate
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find(
      (p) => p.$type === personalDetailsPref.$type,
    ) as app.bsky.actor.defs.PersonalDetailsPref | undefined

    if (existing) {
      return prefs.map((p) =>
        p.$type === personalDetailsPref.$type
          ? { ...p, birthDate: birthDateStr }
          : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#personalDetailsPref',
        birthDate: birthDateStr,
      } as app.bsky.actor.defs.PersonalDetailsPref & {
        $type: 'app.bsky.actor.defs#personalDetailsPref'
      },
    ] as Preferences
  })
}

export const setInterestsPref: Action<{ tags: string[] }, void> = async (
  client,
  { tags },
) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === interestsPref.$type) as
      app.bsky.actor.defs.InterestsPref | undefined

    if (existing) {
      return prefs.map((p) =>
        p.$type === interestsPref.$type ? { ...p, tags } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#interestsPref',
        tags,
      } as app.bsky.actor.defs.InterestsPref & {
        $type: 'app.bsky.actor.defs#interestsPref'
      },
    ] as Preferences
  })
}

/**
 * Helper: backfill id for legacy muted words without id (old agent.ts:1626-1631)
 */
function migrateLegacyMutedWordsItems(
  items: app.bsky.actor.defs.MutedWord[],
): app.bsky.actor.defs.MutedWord[] {
  return items.map((item) => ({
    ...item,
    id: item.id || nextTid(),
  }))
}

/**
 * Helper: match muted word by id (preferred) or by value (legacy fallback)
 * (old agent.ts:1633-1645)
 */
function matchMutedWord(
  existingWord: app.bsky.actor.defs.MutedWord,
  newWord: app.bsky.actor.defs.MutedWord,
): boolean {
  const existingId = existingWord.id
  const matchById = existingId && existingId === newWord.id
  const legacyMatchByValue = !existingId && existingWord.value === newWord.value
  return !!(matchById || legacyMatchByValue)
}

/**
 * Add a single muted word. (old agent.ts:1070-1112)
 */
export const addMutedWord: Action<
  Pick<
    app.bsky.actor.defs.MutedWord,
    'value' | 'targets' | 'actorTarget' | 'expiresAt'
  >,
  void
> = async (client, mutedWord) => {
  const sanitizedValue = sanitizeMutedWordValue(mutedWord.value)
  if (!sanitizedValue) return

  await client.call(updatePreferences, (prefs) => {
    let mutedWordsPrefEntry = prefs.find(
      (p) => p.$type === mutedWordsPref.$type,
    ) as app.bsky.actor.defs.MutedWordsPref | undefined

    const newMutedWord: app.bsky.actor.defs.MutedWord = {
      id: nextTid(),
      value: sanitizedValue,
      targets: mutedWord.targets || [],
      actorTarget: mutedWord.actorTarget || 'all',
      expiresAt: mutedWord.expiresAt || undefined,
    }

    if (mutedWordsPrefEntry) {
      mutedWordsPrefEntry.items.push(newMutedWord)
      // Migrate any old muted words that don't have an id
      mutedWordsPrefEntry.items = migrateLegacyMutedWordsItems(
        mutedWordsPrefEntry.items,
      )
    } else {
      mutedWordsPrefEntry = {
        $type: 'app.bsky.actor.defs#mutedWordsPref',
        items: [newMutedWord],
      } as app.bsky.actor.defs.MutedWordsPref & {
        $type: 'app.bsky.actor.defs#mutedWordsPref'
      }
    }

    return prefs
      .filter((p) => p.$type !== mutedWordsPref.$type)
      .concat(
        mutedWordsPrefEntry as app.bsky.actor.defs.MutedWordsPref & {
          $type: 'app.bsky.actor.defs#mutedWordsPref'
        },
      ) as Preferences
  })
}

/**
 * Convenience method to add multiple muted words. (old agent.ts:1117-1119)
 */
export const addMutedWords: Action<
  app.bsky.actor.defs.MutedWord[],
  void
> = async (client, words) => {
  await Promise.all(words.map((word) => client.call(addMutedWord, word)))
}

/**
 * @deprecated use addMutedWords or addMutedWord instead (old agent.ts:1124-1131)
 */
export const upsertMutedWords: Action<
  Pick<
    app.bsky.actor.defs.MutedWord,
    'value' | 'targets' | 'actorTarget' | 'expiresAt'
  >[],
  void
> = async (client, words) => {
  await client.call(addMutedWords, words as app.bsky.actor.defs.MutedWord[])
}

/**
 * Update a muted word in user preferences. (old agent.ts:1136-1176)
 */
export const updateMutedWord: Action<
  app.bsky.actor.defs.MutedWord,
  void
> = async (client, mutedWord) => {
  await client.call(updatePreferences, (prefs) => {
    const mutedWordsPrefEntry = prefs.find(
      (p) => p.$type === mutedWordsPref.$type,
    ) as app.bsky.actor.defs.MutedWordsPref | undefined

    if (mutedWordsPrefEntry) {
      mutedWordsPrefEntry.items = mutedWordsPrefEntry.items.map(
        (existingItem) => {
          const match = matchMutedWord(existingItem, mutedWord)
          if (match) {
            const updated = {
              ...existingItem,
              ...mutedWord,
            }
            return {
              id: existingItem.id || nextTid(),
              value:
                sanitizeMutedWordValue(updated.value) || existingItem.value,
              targets: updated.targets || [],
              actorTarget: updated.actorTarget || 'all',
              expiresAt: updated.expiresAt || undefined,
            }
          } else {
            return existingItem
          }
        },
      )

      // Migrate any old muted words that don't have an id
      mutedWordsPrefEntry.items = migrateLegacyMutedWordsItems(
        mutedWordsPrefEntry.items,
      )

      return prefs
        .filter((p) => p.$type !== mutedWordsPref.$type)
        .concat(
          mutedWordsPrefEntry as app.bsky.actor.defs.MutedWordsPref & {
            $type: 'app.bsky.actor.defs#mutedWordsPref'
          },
        ) as Preferences
    }

    return prefs
  })
}

/**
 * Remove a single muted word (old agent.ts:1182-1209)
 */
export const removeMutedWord: Action<
  app.bsky.actor.defs.MutedWord,
  void
> = async (client, mutedWord) => {
  await client.call(updatePreferences, (prefs) => {
    const mutedWordsPrefEntry = prefs.find(
      (p) => p.$type === mutedWordsPref.$type,
    ) as app.bsky.actor.defs.MutedWordsPref | undefined
    if (!mutedWordsPrefEntry) return prefs

    for (let i = 0; i < mutedWordsPrefEntry.items.length; i++) {
      const match = matchMutedWord(mutedWordsPrefEntry.items[i], mutedWord)
      if (match) {
        mutedWordsPrefEntry.items.splice(i, 1)
        break
      }
    }

    // Migrate any old muted words that don't have an id
    mutedWordsPrefEntry.items = migrateLegacyMutedWordsItems(
      mutedWordsPrefEntry.items,
    )

    return prefs
      .filter((p) => p.$type !== mutedWordsPref.$type)
      .concat(
        mutedWordsPrefEntry as app.bsky.actor.defs.MutedWordsPref & {
          $type: 'app.bsky.actor.defs#mutedWordsPref'
        },
      ) as Preferences
  })
}

/**
 * Convenience method to remove multiple muted words. (old agent.ts:1214-1216)
 */
export const removeMutedWords: Action<
  app.bsky.actor.defs.MutedWord[],
  void
> = async (client, words) => {
  await Promise.all(words.map((word) => client.call(removeMutedWord, word)))
}

export const hidePost: Action<string, void> = async (client, uri) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === hiddenPostsPref.$type) as
      app.bsky.actor.defs.HiddenPostsPref | undefined
    const currentItems = existing?.items ?? []

    if (currentItems.includes(uri as AtUriString)) return false

    const updated = [...currentItems, uri as AtUriString]

    if (existing) {
      return prefs.map((p) =>
        p.$type === hiddenPostsPref.$type ? { ...p, items: updated } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#hiddenPostsPref',
        items: updated,
      } as app.bsky.actor.defs.HiddenPostsPref & {
        $type: 'app.bsky.actor.defs#hiddenPostsPref'
      },
    ] as Preferences
  })
}

export const unhidePost: Action<string, void> = async (client, uri) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === hiddenPostsPref.$type) as
      app.bsky.actor.defs.HiddenPostsPref | undefined
    if (!existing) return false

    const updated = existing.items.filter((u) => u !== uri)
    return prefs.map((p) =>
      p.$type === hiddenPostsPref.$type ? { ...p, items: updated } : p,
    ) as Preferences
  })
}

export const addLabeler: Action<string, void> = async (client, did) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === labelersPref.$type) as
      app.bsky.actor.defs.LabelersPref | undefined
    const currentLabelers = existing?.labelers ?? []

    if (currentLabelers.some((l) => l.did === did)) return false

    const updated = [...currentLabelers, { did: did as `did:${string}` }]

    if (existing) {
      return prefs.map((p) =>
        p.$type === labelersPref.$type ? { ...p, labelers: updated } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#labelersPref',
        labelers: updated,
      } as app.bsky.actor.defs.LabelersPref & {
        $type: 'app.bsky.actor.defs#labelersPref'
      },
    ] as Preferences
  })
}

export const removeLabeler: Action<string, void> = async (client, did) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === labelersPref.$type) as
      app.bsky.actor.defs.LabelersPref | undefined
    if (!existing) return false

    const updated = existing.labelers.filter((l) => l.did !== did)
    return prefs.map((p) =>
      p.$type === labelersPref.$type ? { ...p, labelers: updated } : p,
    ) as Preferences
  })
}

export const queueNudges: Action<string[], void> = async (client, nudges) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === bskyAppStatePref.$type) as
      app.bsky.actor.defs.BskyAppStatePref | undefined
    const currentNudges = existing?.queuedNudges ?? []
    const toAdd = nudges.filter((n) => !currentNudges.includes(n))
    const updated = [...currentNudges, ...toAdd]

    if (existing) {
      return prefs.map((p) =>
        p.$type === bskyAppStatePref.$type
          ? { ...p, queuedNudges: updated }
          : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#bskyAppStatePref',
        queuedNudges: updated,
      } as app.bsky.actor.defs.BskyAppStatePref & {
        $type: 'app.bsky.actor.defs#bskyAppStatePref'
      },
    ] as Preferences
  })
}

export const dismissNudges: Action<string[], void> = async (client, nudges) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === bskyAppStatePref.$type) as
      app.bsky.actor.defs.BskyAppStatePref | undefined
    if (!existing) return false

    const updated = (existing.queuedNudges ?? []).filter(
      (n) => !nudges.includes(n),
    )
    return prefs.map((p) =>
      p.$type === bskyAppStatePref.$type ? { ...p, queuedNudges: updated } : p,
    ) as Preferences
  })
}

export const setActiveProgressGuide: Action<
  app.bsky.actor.defs.BskyAppProgressGuide | undefined,
  void
> = async (client, guide) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === bskyAppStatePref.$type) as
      app.bsky.actor.defs.BskyAppStatePref | undefined

    if (existing) {
      return prefs.map((p) =>
        p.$type === bskyAppStatePref.$type
          ? { ...p, activeProgressGuide: guide }
          : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#bskyAppStatePref',
        activeProgressGuide: guide,
      } as app.bsky.actor.defs.BskyAppStatePref & {
        $type: 'app.bsky.actor.defs#bskyAppStatePref'
      },
    ] as Preferences
  })
}

export const upsertNux: Action<app.bsky.actor.defs.Nux, void> = async (
  client,
  nux,
) => {
  validateNux(nux)
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === bskyAppStatePref.$type) as
      app.bsky.actor.defs.BskyAppStatePref | undefined
    const currentNuxs = existing?.nuxs ?? []

    const idx = currentNuxs.findIndex((n) => n.id === nux.id)
    let updatedNuxs: app.bsky.actor.defs.Nux[]
    if (idx >= 0) {
      updatedNuxs = currentNuxs.map((n, i) => (i === idx ? nux : n))
    } else {
      updatedNuxs = [...currentNuxs, nux]
    }

    if (existing) {
      return prefs.map((p) =>
        p.$type === bskyAppStatePref.$type ? { ...p, nuxs: updatedNuxs } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#bskyAppStatePref',
        nuxs: updatedNuxs,
      } as app.bsky.actor.defs.BskyAppStatePref & {
        $type: 'app.bsky.actor.defs#bskyAppStatePref'
      },
    ] as Preferences
  })
}

export const removeNuxs: Action<string[], void> = async (client, ids) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === bskyAppStatePref.$type) as
      app.bsky.actor.defs.BskyAppStatePref | undefined
    if (!existing) return false

    const updated = (existing.nuxs ?? []).filter((n) => !ids.includes(n.id))
    return prefs.map((p) =>
      p.$type === bskyAppStatePref.$type ? { ...p, nuxs: updated } : p,
    ) as Preferences
  })
}

export const setVerificationPrefs: Action<
  app.bsky.actor.defs.VerificationPrefs,
  void
> = async (client, updates) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find((p) => p.$type === verificationPrefs.$type) as
      app.bsky.actor.defs.VerificationPrefs | undefined

    if (existing) {
      return prefs.map((p) =>
        p.$type === verificationPrefs.$type ? { ...p, ...updates } : p,
      ) as Preferences
    }
    return [
      ...prefs,
      {
        $type: 'app.bsky.actor.defs#verificationPrefs',
        ...updates,
      } as app.bsky.actor.defs.VerificationPrefs & {
        $type: 'app.bsky.actor.defs#verificationPrefs'
      },
    ] as Preferences
  })
}

export const setPostInteractionSettings: Action<
  app.bsky.actor.defs.PostInteractionSettingsPref,
  void
> = async (client, settings) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find(
      (p) => p.$type === postInteractionSettingsPref.$type,
    ) as app.bsky.actor.defs.PostInteractionSettingsPref | undefined

    const pref = existing ?? {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
    }

    // Explicitly assign both fields (old agent.ts:1348-1350):
    // "undefined" means "everyone" - do not merge, replace
    ;(
      pref as app.bsky.actor.defs.PostInteractionSettingsPref
    ).threadgateAllowRules = settings.threadgateAllowRules
    ;(
      pref as app.bsky.actor.defs.PostInteractionSettingsPref
    ).postgateEmbeddingRules = settings.postgateEmbeddingRules

    return prefs
      .filter((p) => p.$type !== postInteractionSettingsPref.$type)
      .concat(
        pref as app.bsky.actor.defs.PostInteractionSettingsPref & {
          $type: 'app.bsky.actor.defs#postInteractionSettingsPref'
        },
      ) as Preferences
  })
}

/**
 * Update live event preferences. (old agent.ts:1380-1413)
 */
export const updateLiveEventPreferences: Action<
  | { type: 'hideFeed'; id: string }
  | { type: 'unhideFeed'; id: string }
  | { type: 'toggleHideAllFeeds' },
  void
> = async (client, action) => {
  await client.call(updatePreferences, (prefs) => {
    const existing = prefs.find(
      (p) => p.$type === liveEventPreferences.$type,
    ) as app.bsky.actor.defs.LiveEventPreferences | undefined

    const pref = existing ?? {
      $type: 'app.bsky.actor.defs#liveEventPreferences',
      hiddenFeedIds: [] as string[],
      hideAllFeeds: false,
    }

    const hiddenFeedIds = new Set<string>(pref.hiddenFeedIds || [])

    switch (action.type) {
      case 'hideFeed':
        hiddenFeedIds.add(action.id)
        break
      case 'unhideFeed':
        hiddenFeedIds.delete(action.id)
        break
      case 'toggleHideAllFeeds':
        ;(pref as app.bsky.actor.defs.LiveEventPreferences).hideAllFeeds =
          !pref.hideAllFeeds
        break
    }

    ;(pref as app.bsky.actor.defs.LiveEventPreferences).hiddenFeedIds = [
      ...hiddenFeedIds,
    ]

    return prefs
      .filter((p) => p.$type !== liveEventPreferences.$type)
      .concat(
        pref as app.bsky.actor.defs.LiveEventPreferences & {
          $type: 'app.bsky.actor.defs#liveEventPreferences'
        },
      ) as Preferences
  })
}
