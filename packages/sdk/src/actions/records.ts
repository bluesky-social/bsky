import {
  type Action,
  type CidString,
  type CreateOutput,
  type DatetimeString,
  type DidString,
  XrpcResponseError,
} from '@atproto/lex'
import { AtUri, type AtUriString, currentDatetimeString } from '@atproto/syntax'
import {
  $type as profileType,
  type Main as ProfileRecord,
  main as profile,
} from '../lexicons/app/bsky/actor/profile.defs.js'
import { main as likeRecord } from '../lexicons/app/bsky/feed/like.defs.js'
import {
  type Main as PostRecord,
  main as postRecord,
} from '../lexicons/app/bsky/feed/post.defs.js'
import { main as repostRecord } from '../lexicons/app/bsky/feed/repost.defs.js'
import { main as followRecord } from '../lexicons/app/bsky/graph/follow.defs.js'
import type { Main as StrongRef } from '../lexicons/com/atproto/repo/strongRef.defs.js'

type PostInput = Omit<PostRecord, '$type' | 'createdAt'> & {
  createdAt?: DatetimeString
}

/**
 * Create a post record.
 */
export const post: Action<PostInput, CreateOutput> = async (
  client,
  { createdAt = currentDatetimeString(), ...input },
) => {
  return client.create(postRecord, {
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
  await client.delete(postRecord, {
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
  return client.create(likeRecord, {
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
  await client.delete(likeRecord, {
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
  return client.create(repostRecord, {
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
  await client.delete(repostRecord, {
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
  return client.create(followRecord, {
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
  await client.delete(followRecord, {
    rkey: urip.rkeySafe,
    // delete must target the record's own DID.
    repo: urip.hostname,
  })
}

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
    const existing = await client.get(profile).catch(() => undefined)

    // Pass undefined to updateFn if the existing record does NOT validate as
    // app.bsky.actor.profile (old agent.ts:465-468: isValidProfile gate).
    const existingValue = existing?.value
    const existingRecord: Partial<ProfileRecord> | undefined = profile.matches(
      existingValue,
    )
      ? existingValue
      : undefined

    const updated = await updateFn(existingRecord)

    // Validate post-update record; throw BEFORE putRecord on failure
    // (old agent.ts:471-476: validateRecord gate).
    profile.check({
      $type: profileType,
      ...updated,
    })

    try {
      await client.put(
        profile,
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
