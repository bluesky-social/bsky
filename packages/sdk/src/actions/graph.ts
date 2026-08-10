import {
  type Action,
  type AtIdentifierString,
  type CreateOutput,
} from '@atproto/lex'
import { AtUri, type AtUriString, currentDatetimeString } from '@atproto/syntax'
import { app as appLexicons } from '../lexicons/index.js'

/**
 * Mute an actor (user). When an `only` scope is set, just the scoped content
 * is muted; when none are set, the account is fully muted. Repeat calls
 * replace the stored scope rather than adding to it.
 */
export const muteActor: Action<
  {
    actor: AtIdentifierString
    onlyReposts?: boolean
    onlyQuoteposts?: boolean
  },
  void
> = async (client, { actor, onlyReposts, onlyQuoteposts }) => {
  await client.call(appLexicons.bsky.graph.muteActor.main, {
    actor,
    onlyReposts,
    onlyQuoteposts,
  })
}

/**
 * Unmute an actor (user).
 */
export const unmuteActor: Action<{ actor: AtIdentifierString }, void> = async (
  client,
  { actor },
) => {
  await client.call(appLexicons.bsky.graph.unmuteActor.main, { actor })
}

/**
 * Mute all accounts in a list.
 */
export const muteActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  await client.call(appLexicons.bsky.graph.muteActorList.main, { list })
}

/**
 * Unmute all accounts in a list.
 */
export const unmuteActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  await client.call(appLexicons.bsky.graph.unmuteActorList.main, { list })
}

/**
 * Block a list by creating a listblock record.
 */
export const blockActorList: Action<
  { list: AtUriString },
  CreateOutput
> = async (client, { list }) => {
  return client.create(appLexicons.bsky.graph.listblock.main, {
    subject: list,
    createdAt: currentDatetimeString(),
  })
}

/**
 * Unblock a list by deleting the listblock record.
 * Looks up the existing block via getList viewer.blocked.
 */
export const unblockActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  const listRes = await client.call(appLexicons.bsky.graph.getList.main, {
    list,
    limit: 1,
  })
  const blocked = listRes.list.viewer?.blocked
  if (blocked) {
    const urip = new AtUri(blocked)
    await client.delete(appLexicons.bsky.graph.listblock.main, {
      rkey: urip.rkey,
    })
  }
}
