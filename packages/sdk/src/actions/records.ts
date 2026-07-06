import {
  type Action,
  type NsidString,
  XrpcResponseError,
} from '@atproto/lex-client'
import type { DatetimeString } from '@atproto/lex-schema'
import { AtUri, currentDatetimeString } from '@atproto/syntax'
import type { app } from '../lexicons/index.js'
import { app as appLexicons, com as comLexicons } from '../lexicons/index.js'

type PostInput = Omit<app.bsky.feed.post.Main, '$type' | 'createdAt'> & {
  createdAt?: DatetimeString
}
type CreateOutput = { uri: string; cid: string }

/**
 * Create a post record.
 */
export const post: Action<PostInput, CreateOutput> = async (client, input) => {
  const record = {
    ...input,
    $type: 'app.bsky.feed.post',
    createdAt: input.createdAt ?? currentDatetimeString(),
  }
  const res = await client.xrpc(comLexicons.atproto.repo.createRecord.main, {
    body: {
      repo: client.assertDid,
      collection: 'app.bsky.feed.post' as NsidString, // wire nsid
      record,
    },
  })
  return res.body as CreateOutput // xrpc response shape
}

/**
 * Delete a post record by URI.
 */
export const deletePost: Action<string, void> = async (client, postUri) => {
  const urip = new AtUri(postUri)
  await client.xrpc(comLexicons.atproto.repo.deleteRecord.main, {
    body: {
      repo: urip.hostname,
      collection: urip.collectionSafe,
      rkey: urip.rkeySafe,
    },
  })
}

type LikeInput = {
  uri: string
  cid: string
  via?: { uri: string; cid: string }
}

/**
 * Create a like record.
 */
export const like: Action<LikeInput, CreateOutput> = async (
  client,
  { uri, cid, via },
) => {
  const record = {
    $type: 'app.bsky.feed.like',
    subject: { uri, cid },
    createdAt: currentDatetimeString(),
    via,
  }
  const res = await client.xrpc(comLexicons.atproto.repo.createRecord.main, {
    body: {
      repo: client.assertDid,
      collection: 'app.bsky.feed.like' as NsidString, // wire nsid
      record,
    },
  })
  return res.body as CreateOutput // xrpc response shape
}

/**
 * Delete a like record by URI.
 */
export const deleteLike: Action<string, void> = async (client, likeUri) => {
  const urip = new AtUri(likeUri)
  await client.xrpc(comLexicons.atproto.repo.deleteRecord.main, {
    body: {
      repo: urip.hostname,
      collection: urip.collectionSafe,
      rkey: urip.rkeySafe,
    },
  })
}

type RepostInput = {
  uri: string
  cid: string
  via?: { uri: string; cid: string }
}

/**
 * Create a repost record.
 */
export const repost: Action<RepostInput, CreateOutput> = async (
  client,
  { uri, cid, via },
) => {
  const record = {
    $type: 'app.bsky.feed.repost',
    subject: { uri, cid },
    createdAt: currentDatetimeString(),
    via,
  }
  const res = await client.xrpc(comLexicons.atproto.repo.createRecord.main, {
    body: {
      repo: client.assertDid,
      collection: 'app.bsky.feed.repost' as NsidString, // wire nsid
      record,
    },
  })
  return res.body as CreateOutput // xrpc response shape
}

/**
 * Delete a repost record by URI.
 */
export const deleteRepost: Action<string, void> = async (client, repostUri) => {
  const urip = new AtUri(repostUri)
  await client.xrpc(comLexicons.atproto.repo.deleteRecord.main, {
    body: {
      repo: urip.hostname,
      collection: urip.collectionSafe,
      rkey: urip.rkeySafe,
    },
  })
}

type FollowInput = { did: string; via?: { uri: string; cid: string } }

/**
 * Create a follow record.
 */
export const follow: Action<FollowInput, CreateOutput> = async (
  client,
  { did, via },
) => {
  const record = {
    $type: 'app.bsky.graph.follow',
    subject: did,
    createdAt: currentDatetimeString(),
    via,
  }
  const res = await client.xrpc(comLexicons.atproto.repo.createRecord.main, {
    body: {
      repo: client.assertDid,
      collection: 'app.bsky.graph.follow' as NsidString, // wire nsid
      record,
    },
  })
  return res.body as CreateOutput // xrpc response shape
}

/**
 * Delete a follow record by URI.
 */
export const deleteFollow: Action<string, void> = async (client, followUri) => {
  const urip = new AtUri(followUri)
  await client.xrpc(comLexicons.atproto.repo.deleteRecord.main, {
    body: {
      repo: urip.hostname,
      collection: urip.collectionSafe,
      rkey: urip.rkeySafe,
    },
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
      .xrpc(comLexicons.atproto.repo.getRecord.main, {
        params: {
          repo: client.assertDid,
          collection: 'app.bsky.actor.profile' as NsidString, // wire nsid
          rkey: 'self',
        },
      })
      .catch(() => undefined)

    // Pass undefined to updateFn if the existing record does NOT validate as
    // app.bsky.actor.profile (old agent.ts:465-468: isValidProfile gate).
    const existingValue = existing?.body.value
    const existingRecord: Partial<ProfileRecord> | undefined =
      appLexicons.bsky.actor.profile.main.matches(existingValue)
        ? existingValue
        : undefined

    const updated = await updateFn(existingRecord)

    // Validate post-update record; throw BEFORE putRecord on failure
    // (old agent.ts:471-476: validateRecord gate).
    appLexicons.bsky.actor.profile.main.check({
      $type: 'app.bsky.actor.profile',
      ...updated,
    })

    try {
      await client.xrpc(comLexicons.atproto.repo.putRecord.main, {
        body: {
          repo: client.assertDid,
          collection: 'app.bsky.actor.profile' as NsidString, // wire nsid
          rkey: 'self',
          record: { $type: 'app.bsky.actor.profile', ...updated },
          swapRecord: existing?.body.cid ?? null,
        },
      })
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
