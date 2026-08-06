import {
  type Action,
  type CidString,
  type CreateOutput,
  type DatetimeString,
  type DidString,
  XrpcResponseError,
} from '@atproto/lex'
import { AtUri, type AtUriString, currentDatetimeString } from '@atproto/syntax'
import type { app, com } from '../lexicons/index.js'
import { app as appLexicons } from '../lexicons/index.js'

type StrongRef = com.atproto.repo.strongRef.Main

type PostInput = Omit<app.bsky.feed.post.Main, '$type' | 'createdAt'> & {
  createdAt?: DatetimeString
}

/**
 * Create a post record.
 */
export const post: Action<PostInput, CreateOutput> = async (
  client,
  { createdAt = currentDatetimeString(), ...input },
) => {
  return client.create(appLexicons.bsky.feed.post.main, {
    ...input,
    createdAt,
  })
}

/**
 * Delete a post record by URI.
 */
export const deletePost: Action<AtUriString, void> = async (
  client,
  postUri,
) => {
  const urip = new AtUri(postUri)
  await client.delete(appLexicons.bsky.feed.post.main, {
    rkey: urip.rkeySafe,
    // delete must target the record's own DID, which may differ from
    // client.assertDid in admin/mod flows.
    repo: urip.hostname,
  })
}

type LikeInput = {
  uri: AtUriString
  cid: CidString
  via?: StrongRef
}

/**
 * Create a like record.
 */
export const like: Action<LikeInput, CreateOutput> = async (
  client,
  { uri, cid, via },
) => {
  return client.create(appLexicons.bsky.feed.like.main, {
    subject: { uri, cid },
    createdAt: currentDatetimeString(),
    via,
  })
}

/**
 * Delete a like record by URI.
 */
export const deleteLike: Action<AtUriString, void> = async (
  client,
  likeUri,
) => {
  const urip = new AtUri(likeUri)
  await client.delete(appLexicons.bsky.feed.like.main, {
    rkey: urip.rkeySafe,
    // delete must target the record's own DID.
    repo: urip.hostname,
  })
}

type RepostInput = {
  uri: AtUriString
  cid: CidString
  via?: StrongRef
}

/**
 * Create a repost record.
 */
export const repost: Action<RepostInput, CreateOutput> = async (
  client,
  { uri, cid, via },
) => {
  return client.create(appLexicons.bsky.feed.repost.main, {
    subject: { uri, cid },
    createdAt: currentDatetimeString(),
    via,
  })
}

/**
 * Delete a repost record by URI.
 */
export const deleteRepost: Action<AtUriString, void> = async (
  client,
  repostUri,
) => {
  const urip = new AtUri(repostUri)
  await client.delete(appLexicons.bsky.feed.repost.main, {
    rkey: urip.rkeySafe,
    // delete must target the record's own DID.
    repo: urip.hostname,
  })
}

type FollowInput = { did: DidString; via?: StrongRef }

/**
 * Create a follow record.
 */
export const follow: Action<FollowInput, CreateOutput> = async (
  client,
  { did, via },
) => {
  return client.create(appLexicons.bsky.graph.follow.main, {
    subject: did,
    createdAt: currentDatetimeString(),
    via,
  })
}

/**
 * Delete a follow record by URI.
 */
export const deleteFollow: Action<AtUriString, void> = async (
  client,
  followUri,
) => {
  const urip = new AtUri(followUri)
  await client.delete(appLexicons.bsky.graph.follow.main, {
    rkey: urip.rkeySafe,
    // delete must target the record's own DID.
    repo: urip.hostname,
  })
}

type ProfileRecord = app.bsky.actor.profile.Main
type UpsertProfileInput = (
  existing: Partial<ProfileRecord> | undefined,
) => Partial<ProfileRecord> | Promise<Partial<ProfileRecord>>

/**
 * Upsert (create or update) the authenticated user's profile record.
 * Retries up to 5 times on InvalidSwap to handle concurrent writes.
 */
export const upsertProfile: Action<UpsertProfileInput, void> = async (
  client,
  updateFn,
) => {
  const MAX_RETRIES = 5
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Fetch the current profile record
    const existing = await client
      .get(appLexicons.bsky.actor.profile.main)
      .catch(() => undefined)

    // Pass undefined to updateFn if the existing record does NOT validate as
    // app.bsky.actor.profile (old agent.ts:465-468: isValidProfile gate).
    const existingValue = existing?.value
    const existingRecord: Partial<ProfileRecord> | undefined =
      appLexicons.bsky.actor.profile.main.matches(existingValue)
        ? existingValue
        : undefined

    const updated = await updateFn(existingRecord)

    // Validate post-update record; throw BEFORE putRecord on failure
    // (old agent.ts:471-476: validateRecord gate).
    appLexicons.bsky.actor.profile.main.check({
      $type: appLexicons.bsky.actor.profile.$type,
      ...updated,
    })

    try {
      await client.put(
        appLexicons.bsky.actor.profile.main,
        { ...updated },
        // swapRecord: undefined when no existing cid → no swap check (permissive).
        // PutRecordOptions does not expose null (assert-not-exists); retry loop
        // handles InvalidSwap races either way.
        { swapRecord: existing?.cid },
      )
      return
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e
      if (e instanceof XrpcResponseError && e.error === 'InvalidSwap') {
        continue
      }
      throw e
    }
  }
}
