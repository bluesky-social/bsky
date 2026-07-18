import { type Action, Client, type Service } from '@atproto/lex'
import type { AtUriString, DatetimeString, DidString } from '@atproto/syntax'
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
import type {
  LabelPreference,
  ModerationPrefsLabeler,
} from '../moderation/index.js'
import { DEFAULT_LABEL_SETTINGS } from '../moderation/index.js'
import { nextTid } from '../tid.js'
import { sanitizeMutedWordValue, validateNux } from '../utils/index.js'
import { isTypeOf } from '../utils/types.js'
import type {
  BskyFeedViewPreference,
  BskyPreferences,
  BskyThreadViewPreference,
} from './types.js'

type Preferences = app.bsky.actor.defs.Preferences
type SavedFeed = app.bsky.actor.defs.SavedFeed

// Serializes preference read-modify-write cycles per client, replacing the
// old Agent's per-instance AwaitLock. Keyed weakly so clients can be GC'd.
const prefsWriteChains = /*#__PURE__*/ new WeakMap<object, Promise<unknown>>()

function serializedPrefsWrite<T>(
  client: object,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = prefsWriteChains.get(client) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run regardless of predecessor outcome
  prefsWriteChains.set(client, next)
  return next
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

/**
 * Adjusts a stored contentLabelPref visibility on read: 'show' is a legacy
 * value remapped to 'ignore'; any other unknown value is passed through
 * unchanged, matching the old agent's behavior.
 */
function normalizeVisibility(
  visibility: app.bsky.actor.defs.ContentLabelPref['visibility'],
): LabelPreference {
  if (visibility === 'show') return 'ignore'
  return visibility as LabelPreference
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
 * Preference reads/writes target the user's account host by default (like
 * the client's own record helpers), regardless of the client's `service`
 * default — preferences live on the PDS, not behind the AppView proxy.
 * Pass `service` to override.
 */
export interface PrefsServiceOptions {
  service?: Service | null
}

type UpdatePreferencesInput =
  | ((prefs: Preferences) => Preferences | false)
  | ({
      update: (prefs: Preferences) => Preferences | false
    } & PrefsServiceOptions)

/**
 * Builds a preference mutation action from a function that derives an
 * update callback from the action's input. Returning null skips the write.
 */
function prefsUpdater<I>(
  makeUpdate: (
    input: I,
    client: Client,
  ) => ((prefs: Preferences) => Preferences | false) | null,
): Action<I, void> {
  return async (client, input) => {
    const update = makeUpdate(input, client)
    if (!update) return
    await client.call(updatePreferences, update)
  }
}

/**
 * Low-level helper to update the raw preferences array on the server.
 *
 * Concurrent calls on the same Client are automatically serialized: each
 * read-modify-write cycle waits for the previous one to complete before
 * starting, matching the old Agent's per-instance AwaitLock behavior.
 */
export const updatePreferences: Action<UpdatePreferencesInput, Preferences> = (
  client,
  input,
) => {
  const { update: cb, service = null } =
    typeof input === 'function' ? { update: input } : input
  return serializedPrefsWrite(client, async () => {
    const res = await client.xrpc(appLexicons.bsky.actor.getPreferences.main, {
      params: {},
      service,
    })
    const current = res.body.preferences
    const result = cb(current)
    if (result === false) return current
    await client.xrpc(appLexicons.bsky.actor.putPreferences.main, {
      body: { preferences: result },
      service,
    })
    return result
  })
}

/**
 * Fetches and interprets the current user's preferences into a structured BskyPreferences object.
 * Migrates v1 savedFeeds to v2 on first read.
 */
export const getPreferences: Action<
  void | PrefsServiceOptions,
  BskyPreferences
> = async (client, input) => {
  const service = input?.service ?? null
  const res = await client.xrpc(appLexicons.bsky.actor.getPreferences.main, {
    params: {},
    service,
  })
  const prefs = res.body.preferences

  // Migrate v1 saved feeds to v2 if needed. The migrated feeds are used for
  // this call's result directly; the write happens via overwriteSavedFeeds
  // (serialized, validated) so the migration doesn't re-occur.
  // (old agent.ts:687-746)
  let migratedSavedFeeds: SavedFeed[] | undefined
  const hasV2 = prefs.some((p) => isTypeOf(savedFeedsPrefV2, p))
  const v1 = prefs.find((p) => isTypeOf(savedFeedsPref, p))

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

    migratedSavedFeeds = Array.from(uniqueMigratedSavedFeeds.values())
    // Save so this migration doesn't re-occur (old agent.ts:744-745). Routed
    // through overwriteSavedFeeds so the write is serialized with other
    // preference mutations, validated, and double-written to the v1 pref.
    await overwriteSavedFeedsImpl(client, migratedSavedFeeds, service)
  } else if (!hasV2) {
    // No v1 either, add a default timeline feed
    migratedSavedFeeds = [
      {
        id: nextTid(),
        type: 'timeline',
        value: 'following',
        pinned: true,
      },
    ]
    await overwriteSavedFeedsImpl(client, migratedSavedFeeds, service)
  }
  // Parse out each pref type
  const adultContent = prefs.find((p) => isTypeOf(adultContentPref, p))
  const personalDetails = prefs.find((p) => isTypeOf(personalDetailsPref, p))
  const declaredAge = prefs.find((p) => isTypeOf(declaredAgePref, p))
  const labelPrefs = prefs.filter((p) => isTypeOf(contentLabelPref, p))
  const feedViewPrefsArr = prefs.filter((p) => isTypeOf(feedViewPref, p))
  const threadView = prefs.find((p) => isTypeOf(threadViewPref, p))
  const interests = prefs.find((p) => isTypeOf(interestsPref, p))
  const mutedWords = prefs.find((p) => isTypeOf(mutedWordsPref, p))
  const hiddenPosts = prefs.find((p) => isTypeOf(hiddenPostsPref, p))
  const labelersP = prefs.find((p) => isTypeOf(labelersPref, p))
  const bskyAppState = prefs.find((p) => isTypeOf(bskyAppStatePref, p))
  const postInteraction = prefs.find((p) =>
    isTypeOf(postInteractionSettingsPref, p),
  )
  const verificationP = prefs.find((p) => isTypeOf(verificationPrefs, p))
  const liveEventP = prefs.find((p) => isTypeOf(liveEventPreferences, p))

  // v2 saved feeds — when a migration just ran, use its result directly
  // rather than re-reading from the server (old agent.ts:732-741)
  const v2Pref = prefs.find((p) => isTypeOf(savedFeedsPrefV2, p))
  const savedFeeds: SavedFeed[] = migratedSavedFeeds ?? v2Pref?.items ?? []

  // Legacy v1 arrays (deprecated)
  const v1Pref = prefs.find((p) => isTypeOf(savedFeedsPref, p))
  const legacyFeeds = {
    saved: v1Pref?.saved,
    pinned: v1Pref?.pinned,
  }

  // Build labels record, seeding with DEFAULT_LABEL_SETTINGS first (old agent.ts:568)
  const labels: Record<string, LabelPreference> = { ...DEFAULT_LABEL_SETTINGS }
  for (const labelPref of labelPrefs) {
    if (labelPref.labelerDid) continue // skip labeler-specific prefs for global map
    const visibility = normalizeVisibility(labelPref.visibility)
    // remap legacy label names
    const mappedName = LABEL_REMAP[labelPref.label] ?? labelPref.label
    labels[mappedName] = visibility
    // also set the original legacy name if it was remapped
    if (LABEL_REMAP[labelPref.label]) {
      labels[labelPref.label] = visibility
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
  // Merge app labelers with user labelers (user labelers override or extend)
  const allLabelerDids = new Set<DidString>([
    ...Client.appLabelers,
    ...(labelersP?.labelers ?? []).map((l) => l.did),
  ])
  const mergedLabelers = [...allLabelerDids].map(
    (did): ModerationPrefsLabeler => ({ did, labels: {} }),
  )

  // Apply labeler-specific label prefs
  for (const labelPref of labelPrefs) {
    if (!labelPref.labelerDid) continue
    const labelerEntry = mergedLabelers.find(
      (l) => l.did === labelPref.labelerDid,
    )
    if (labelerEntry) {
      labelerEntry.labels[labelPref.label] = normalizeVisibility(
        labelPref.visibility,
      )
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
      // only present when set (old agent.ts:659-661)
      ...(bskyAppState?.isBetaUser !== undefined && {
        isBetaUser: bskyAppState.isBetaUser,
      }),
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

export const setAdultContentEnabled: Action<boolean, void> = prefsUpdater(
  (enabled) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(adultContentPref, p))
    if (existing) {
      return prefs.map((p) =>
        isTypeOf(adultContentPref, p) ? { ...p, enabled } : p,
      )
    }
    return [
      ...prefs,
      {
        $type: adultContentPref.$type,
        enabled,
      },
    ]
  },
)

export const setContentLabelPref: Action<
  { key: string; value: LabelPreference; labelerDid?: DidString },
  void
> = prefsUpdater(({ key, value, labelerDid }) => {
  // Validate labelerDid if provided (old agent.ts:895-897)
  if (labelerDid !== undefined) {
    ensureValidDidRegex(labelerDid)
  }
  return (prefs) => {
    // Remove existing pref for this key+labelerDid combo
    const filtered = prefs.filter((p) => {
      if (!isTypeOf(contentLabelPref, p)) return true
      return !(p.label === key && p.labelerDid === labelerDid)
    })

    // Add new pref for main key
    const newPrefs: Preferences = [
      ...filtered,
      {
        $type: contentLabelPref.$type,
        label: key,
        labelerDid,
        visibility: value,
      },
    ]

    // Double-write for legacy label aliases ONLY when global (no labelerDid)
    // (old agent.ts:911-914: `if (!labelPref.labelerDid)`)
    if (!labelerDid) {
      const legacyAliases = LABEL_REMAP_REVERSE[key] ?? []
      for (const alias of legacyAliases) {
        // Remove existing legacy alias pref
        const withoutAlias = newPrefs.filter((p) => {
          if (!isTypeOf(contentLabelPref, p)) return true
          return !(p.label === alias && p.labelerDid === undefined)
        })
        newPrefs.length = 0
        newPrefs.push(...withoutAlias)
        newPrefs.push({
          $type: contentLabelPref.$type,
          label: alias,
          labelerDid: undefined,
          visibility: value,
        })
      }
    }

    return newPrefs
  }
})

/**
 * v1-compat uri arrays from v2 saved feeds (old util.ts savedFeedsToUriArrays).
 * Callers must pass only 'feed'/'list' type feeds, whose values are AT URIs
 * (enforced at write time by validateSavedFeed) — hence the boundary cast.
 */
function savedFeedsToUriArrays(savedFeeds: SavedFeed[]): {
  pinned: AtUriString[]
  saved: AtUriString[]
} {
  const pinned: AtUriString[] = []
  const saved: AtUriString[] = []
  for (const feed of savedFeeds) {
    const value = feed.value as AtUriString // boundary: see doc comment
    if (feed.pinned) {
      pinned.push(value)
      // saved in v1 includes pinned
      saved.push(value)
    } else {
      saved.push(value)
    }
  }
  return { pinned, saved }
}

/**
 * Shared read-modify-write for the v2 saved feeds pref (old agent.ts
 * updateSavedFeedsV2Preferences, :1516-1567). Applies the callback to the
 * current v2 items, enforces pinned-first ordering, and — during the v1→v2
 * transition — double-writes the v2 uris back into an existing v1 pref
 * (but NOT the other way around).
 */
async function updateSavedFeedsV2Prefs(
  client: Client,
  cb: (items: SavedFeed[]) => SavedFeed[],
  service: Service | null = null,
): Promise<SavedFeed[]> {
  let maybeMutatedSavedFeeds: SavedFeed[] = []

  const update = (prefs: Preferences) => {
    const existingV2Pref = prefs.find((p) => isTypeOf(savedFeedsPrefV2, p)) ?? {
      $type: savedFeedsPrefV2.$type,
      items: [],
    }

    const newSavedFeeds = cb(existingV2Pref.items)
    maybeMutatedSavedFeeds = newSavedFeeds

    // enforce ordering: pinned first, then saved
    // @NOTE: sort is stable, preserving order of items with the same pinned status
    const sortedItems = [...newSavedFeeds].sort((a, b) =>
      a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1,
    )

    let updatedPrefs: Preferences = prefs
      .filter((p) => !isTypeOf(savedFeedsPrefV2, p))
      .concat({
        ...existingV2Pref,
        $type: savedFeedsPrefV2.$type,
        items: sortedItems,
      })

    /*
     * If there's a v1 pref present, this account was migrated from v1 to v2.
     * During the transition period, we double write v2 prefs back to v1,
     * but NOT the other way around. (old agent.ts:1546-1563)
     */
    const existingV1Pref = prefs.find((p) => isTypeOf(savedFeedsPref, p))
    if (existingV1Pref) {
      const { saved, pinned } = existingV1Pref
      const v2Compat = savedFeedsToUriArrays(
        // v1 only supports feeds and lists
        sortedItems.filter((i) => ['feed', 'list'].includes(i.type)),
      )
      updatedPrefs = updatedPrefs
        .filter((p) => !isTypeOf(savedFeedsPref, p))
        .concat({
          ...existingV1Pref,
          $type: savedFeedsPref.$type,
          saved: [...new Set([...saved, ...v2Compat.saved])],
          pinned: [...new Set([...pinned, ...v2Compat.pinned])],
        })
    }

    return updatedPrefs
  }
  await client.call(updatePreferences, { update, service })

  return maybeMutatedSavedFeeds
}

export const addSavedFeeds: Action<
  Pick<SavedFeed, 'type' | 'value' | 'pinned'>[],
  SavedFeed[]
> = async (client, feeds) => {
  const newFeeds: SavedFeed[] = feeds.map((f) => ({ ...f, id: nextTid() }))
  newFeeds.forEach(validateSavedFeed)
  await updateSavedFeedsV2Prefs(client, (items) => [...items, ...newFeeds])
  return newFeeds
}

export const removeSavedFeeds: Action<string[], void> = async (client, ids) => {
  await updateSavedFeedsV2Prefs(client, (items) =>
    items.filter((feed) => !ids.includes(feed.id)),
  )
}

export const updateSavedFeeds: Action<SavedFeed[], void> = async (
  client,
  savedFeedsToUpdate,
) => {
  savedFeedsToUpdate.forEach(validateSavedFeed)
  await updateSavedFeedsV2Prefs(client, (items) =>
    items.map((savedFeed) => {
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
    }),
  )
}

async function overwriteSavedFeedsImpl(
  client: Client,
  feeds: SavedFeed[],
  service: Service | null = null,
): Promise<void> {
  feeds.forEach(validateSavedFeed)
  // dedupe by id, preserving the position of the last occurrence
  // (old agent.ts:772-785)
  const uniqueSavedFeeds = new Map<string, SavedFeed>()
  for (const feed of feeds) {
    if (uniqueSavedFeeds.has(feed.id)) {
      uniqueSavedFeeds.delete(feed.id)
    }
    uniqueSavedFeeds.set(feed.id, feed)
  }
  await updateSavedFeedsV2Prefs(
    client,
    () => Array.from(uniqueSavedFeeds.values()),
    service,
  )
}

export const overwriteSavedFeeds: Action<SavedFeed[], void> = async (
  client,
  feeds,
) => overwriteSavedFeedsImpl(client, feeds)

/**
 * @deprecated use updateSavedFeeds or removeSavedFeeds
 * (old agent.ts:856-862 addPinnedFeed)
 */
export const addPinnedFeed: Action<AtUriString, void> = prefsUpdater(
  (uri) => (prefs) => {
    const feedsPref = prefs.find((p) => isTypeOf(savedFeedsPref, p))
    const currentSaved = feedsPref?.saved ?? []
    const currentPinned = feedsPref?.pinned ?? []
    const newSaved = [...currentSaved.filter((u) => u !== uri), uri]
    const newPinned = [...currentPinned.filter((u) => u !== uri), uri]
    if (feedsPref) {
      return prefs.map((p) =>
        isTypeOf(savedFeedsPref, p)
          ? { ...p, saved: newSaved, pinned: newPinned }
          : p,
      )
    }
    return [
      ...prefs,
      {
        $type: savedFeedsPref.$type,
        saved: newSaved,
        pinned: newPinned,
      },
    ]
  },
)

/**
 * @deprecated use updateSavedFeeds or removeSavedFeeds
 * (old agent.ts:864-870 removePinnedFeed)
 */
export const removePinnedFeed: Action<AtUriString, void> = prefsUpdater(
  (uri) => (prefs) => {
    const feedsPref = prefs.find((p) => isTypeOf(savedFeedsPref, p))
    if (!feedsPref) return false
    const newPinned = feedsPref.pinned.filter((u) => u !== uri)
    return prefs.map((p) =>
      isTypeOf(savedFeedsPref, p) ? { ...p, pinned: newPinned } : p,
    )
  },
)

export const setFeedViewPrefs: Action<
  { feed: string } & Partial<BskyFeedViewPreference>,
  void
> = prefsUpdater(({ feed, ...updates }) => (prefs) => {
  const existing = prefs
    .filter((p) => isTypeOf(feedViewPref, p))
    .find((p) => p.feed === feed)

  const current: app.bsky.actor.defs.FeedViewPref = existing ?? {
    feed,
  }
  const updated = {
    ...current,
    ...updates,
    $type: feedViewPref.$type,
  }

  if (existing) {
    return prefs.map((p) => {
      if (!isTypeOf(feedViewPref, p)) return p
      if (p.feed === feed) return updated
      return p
    })
  }
  return [...prefs, updated]
})

export const setThreadViewPrefs: Action<
  Partial<BskyThreadViewPreference>,
  void
> = prefsUpdater((updates) => (prefs) => {
  const existing = prefs.find((p) => isTypeOf(threadViewPref, p))

  const updated = { ...(existing ?? {}), ...updates }

  if (existing) {
    return prefs.map((p) =>
      isTypeOf(threadViewPref, p) ? { ...p, ...updated } : p,
    )
  }
  return [
    ...prefs,
    {
      $type: threadViewPref.$type,
      ...updated,
    },
  ]
})

export const setPersonalDetails: Action<
  { birthDate: Date | DatetimeString | undefined },
  void
> = prefsUpdater(({ birthDate }) => {
  const birthDateStr =
    birthDate instanceof Date ? toDatetimeString(birthDate) : birthDate
  return (prefs) => {
    const existing = prefs.find((p) => isTypeOf(personalDetailsPref, p))

    if (existing) {
      return prefs.map((p) =>
        isTypeOf(personalDetailsPref, p)
          ? { ...p, birthDate: birthDateStr }
          : p,
      )
    }
    return [
      ...prefs,
      {
        $type: personalDetailsPref.$type,
        birthDate: birthDateStr,
      },
    ]
  }
})

export const setInterestsPref: Action<{ tags: string[] }, void> = prefsUpdater(
  ({ tags }) =>
    (prefs) => {
      const existing = prefs.find((p) => isTypeOf(interestsPref, p))

      if (existing) {
        return prefs.map((p) =>
          isTypeOf(interestsPref, p) ? { ...p, tags } : p,
        )
      }
      return [
        ...prefs,
        {
          $type: interestsPref.$type,
          tags,
        },
      ]
    },
)

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
> = prefsUpdater((mutedWord) => {
  const sanitizedValue = sanitizeMutedWordValue(mutedWord.value)
  if (!sanitizedValue) return null

  return (prefs) => {
    let mutedWordsPrefEntry = prefs.find((p) => isTypeOf(mutedWordsPref, p))

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
        $type: mutedWordsPref.$type,
        items: [newMutedWord],
      }
    }

    return prefs
      .filter((p) => p.$type !== mutedWordsPref.$type)
      .concat({
        ...mutedWordsPrefEntry,
        $type: mutedWordsPref.$type,
      })
  }
})

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
  await client.call(addMutedWords, words)
}

/**
 * Update a muted word in user preferences. (old agent.ts:1136-1176)
 */
export const updateMutedWord: Action<app.bsky.actor.defs.MutedWord, void> =
  prefsUpdater((mutedWord) => (prefs) => {
    const mutedWordsPrefEntry = prefs.find((p) => isTypeOf(mutedWordsPref, p))

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
        .concat({
          ...mutedWordsPrefEntry,
          $type: mutedWordsPref.$type,
        })
    }

    return prefs
  })

/**
 * Remove a single muted word (old agent.ts:1182-1209)
 */
export const removeMutedWord: Action<app.bsky.actor.defs.MutedWord, void> =
  prefsUpdater((mutedWord) => (prefs) => {
    const mutedWordsPrefEntry = prefs.find((p) => isTypeOf(mutedWordsPref, p))
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
      .concat({
        ...mutedWordsPrefEntry,
        $type: mutedWordsPref.$type,
      })
  })

/**
 * Convenience method to remove multiple muted words. (old agent.ts:1214-1216)
 */
export const removeMutedWords: Action<
  app.bsky.actor.defs.MutedWord[],
  void
> = async (client, words) => {
  await Promise.all(words.map((word) => client.call(removeMutedWord, word)))
}

export const hidePost: Action<AtUriString, void> = prefsUpdater(
  (uri) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(hiddenPostsPref, p))
    const currentItems = existing?.items ?? []

    if (currentItems.includes(uri)) return false

    const updated = [...currentItems, uri]

    if (existing) {
      return prefs.map((p) =>
        isTypeOf(hiddenPostsPref, p) ? { ...p, items: updated } : p,
      )
    }
    return [
      ...prefs,
      {
        $type: hiddenPostsPref.$type,
        items: updated,
      },
    ]
  },
)

export const unhidePost: Action<AtUriString, void> = prefsUpdater(
  (uri) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(hiddenPostsPref, p))
    if (!existing) return false

    const updated = existing.items.filter((u) => u !== uri)
    return prefs.map((p) =>
      isTypeOf(hiddenPostsPref, p) ? { ...p, items: updated } : p,
    )
  },
)

export const addLabeler: Action<DidString, void> = prefsUpdater((did) => {
  ensureValidDidRegex(did)
  return (prefs) => {
    const existing = prefs.find((p) => isTypeOf(labelersPref, p))
    const currentLabelers = existing?.labelers ?? []

    if (currentLabelers.some((l) => l.did === did)) return false

    const updated = [...currentLabelers, { did }]

    if (existing) {
      return prefs.map((p) =>
        isTypeOf(labelersPref, p) ? { ...p, labelers: updated } : p,
      )
    }
    return [
      ...prefs,
      {
        $type: labelersPref.$type,
        labelers: updated,
      },
    ]
  }
})

export const removeLabeler: Action<DidString, void> = prefsUpdater(
  (did) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(labelersPref, p))
    if (!existing) return false

    const updated = existing.labelers.filter((l) => l.did !== did)
    return prefs.map((p) =>
      isTypeOf(labelersPref, p) ? { ...p, labelers: updated } : p,
    )
  },
)

export const queueNudges: Action<string[], void> = prefsUpdater(
  (nudges) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(bskyAppStatePref, p))
    const currentNudges = existing?.queuedNudges ?? []
    const toAdd = nudges.filter((n) => !currentNudges.includes(n))
    const updated = [...currentNudges, ...toAdd]

    if (existing) {
      return prefs.map((p) =>
        isTypeOf(bskyAppStatePref, p) ? { ...p, queuedNudges: updated } : p,
      )
    }
    return [
      ...prefs,
      {
        $type: bskyAppStatePref.$type,
        queuedNudges: updated,
      },
    ]
  },
)

export const dismissNudges: Action<string[], void> = prefsUpdater(
  (nudges) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(bskyAppStatePref, p))
    if (!existing) return false

    const updated = (existing.queuedNudges ?? []).filter(
      (n) => !nudges.includes(n),
    )
    return prefs.map((p) =>
      isTypeOf(bskyAppStatePref, p) ? { ...p, queuedNudges: updated } : p,
    )
  },
)

/**
 * Set the flag for participating in the beta features program.
 * (upstream agent.ts setIsBetaUser, atproto#5178)
 */
export const setIsBetaUser: Action<boolean, void> = prefsUpdater(
  (isBetaUser) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(bskyAppStatePref, p))

    if (existing) {
      return prefs.map((p) =>
        isTypeOf(bskyAppStatePref, p) ? { ...p, isBetaUser } : p,
      )
    }
    return [
      ...prefs,
      {
        $type: bskyAppStatePref.$type,
        isBetaUser,
      },
    ]
  },
)

export const setActiveProgressGuide: Action<
  app.bsky.actor.defs.BskyAppProgressGuide | undefined,
  void
> = prefsUpdater((guide) => (prefs) => {
  const existing = prefs.find((p) => isTypeOf(bskyAppStatePref, p))

  if (existing) {
    return prefs.map((p) =>
      isTypeOf(bskyAppStatePref, p) ? { ...p, activeProgressGuide: guide } : p,
    )
  }
  return [
    ...prefs,
    {
      $type: bskyAppStatePref.$type,
      activeProgressGuide: guide,
    },
  ]
})

export const upsertNux: Action<app.bsky.actor.defs.Nux, void> = prefsUpdater(
  (nux) => {
    validateNux(nux)
    return (prefs) => {
      const existing = prefs.find((p) => isTypeOf(bskyAppStatePref, p))
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
          isTypeOf(bskyAppStatePref, p) ? { ...p, nuxs: updatedNuxs } : p,
        )
      }
      return [
        ...prefs,
        {
          $type: bskyAppStatePref.$type,
          nuxs: updatedNuxs,
        },
      ]
    }
  },
)

export const removeNuxs: Action<string[], void> = prefsUpdater(
  (ids) => (prefs) => {
    const existing = prefs.find((p) => isTypeOf(bskyAppStatePref, p))
    if (!existing) return false

    const updated = (existing.nuxs ?? []).filter((n) => !ids.includes(n.id))
    return prefs.map((p) =>
      isTypeOf(bskyAppStatePref, p) ? { ...p, nuxs: updated } : p,
    )
  },
)

export const setVerificationPrefs: Action<
  app.bsky.actor.defs.VerificationPrefs,
  void
> = prefsUpdater((updates) => (prefs) => {
  const existing = prefs.find((p) => isTypeOf(verificationPrefs, p))

  if (existing) {
    return prefs.map((p) =>
      isTypeOf(verificationPrefs, p) ? { ...p, ...updates } : p,
    )
  }
  return [
    ...prefs,
    {
      $type: verificationPrefs.$type,
      ...updates,
    },
  ]
})

export const setPostInteractionSettings: Action<
  app.bsky.actor.defs.PostInteractionSettingsPref,
  void
> = prefsUpdater((settings) => (prefs) => {
  const existing = prefs.find((p) => isTypeOf(postInteractionSettingsPref, p))

  // Explicitly assign both fields (old agent.ts:1348-1350):
  // "undefined" means "everyone" - do not merge, replace
  const pref = {
    ...existing,
    $type: postInteractionSettingsPref.$type,
    threadgateAllowRules: settings.threadgateAllowRules,
    postgateEmbeddingRules: settings.postgateEmbeddingRules,
  }

  return prefs
    .filter((p) => !isTypeOf(postInteractionSettingsPref, p))
    .concat(pref)
})

/**
 * Update live event preferences. (old agent.ts:1380-1413)
 */
export const updateLiveEventPreferences: Action<
  | { type: 'hideFeed'; id: string }
  | { type: 'unhideFeed'; id: string }
  | { type: 'toggleHideAllFeeds' },
  void
> = prefsUpdater((action) => (prefs) => {
  const existing = prefs.find((p) => isTypeOf(liveEventPreferences, p))

  const hiddenFeedIds = new Set<string>(existing?.hiddenFeedIds || [])
  let hideAllFeeds = existing?.hideAllFeeds ?? false

  switch (action.type) {
    case 'hideFeed':
      hiddenFeedIds.add(action.id)
      break
    case 'unhideFeed':
      hiddenFeedIds.delete(action.id)
      break
    case 'toggleHideAllFeeds':
      hideAllFeeds = !hideAllFeeds
      break
  }

  const pref = {
    ...existing,
    $type: liveEventPreferences.$type,
    hiddenFeedIds: [...hiddenFeedIds],
    hideAllFeeds,
  }

  return prefs.filter((p) => !isTypeOf(liveEventPreferences, p)).concat(pref)
})
