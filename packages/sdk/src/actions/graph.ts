import {
  type Action,
  type AtIdentifierString,
  type CreateOutput,
  type DidString,
} from '@atproto/lex'
import { AtUri, type AtUriString, currentDatetimeString } from '@atproto/syntax'
import { main as block } from '../lexicons/app/bsky/graph/block.defs.js'
import { main as getList } from '../lexicons/app/bsky/graph/getList.defs.js'
import { main as listblock } from '../lexicons/app/bsky/graph/listblock.defs.js'
import { main as muteActorLexicon } from '../lexicons/app/bsky/graph/muteActor.defs.js'
import { main as muteActorListLexicon } from '../lexicons/app/bsky/graph/muteActorList.defs.js'
import { main as unmuteActorLexicon } from '../lexicons/app/bsky/graph/unmuteActor.defs.js'
import { main as unmuteActorListLexicon } from '../lexicons/app/bsky/graph/unmuteActorList.defs.js'

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
  await client.call(muteActorLexicon, {
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
  await client.call(unmuteActorLexicon, { actor })
}

/**
 * Block an actor (user) by creating a block record.
 */
export const blockActor: Action<{ did: DidString }, CreateOutput> = async (
  client,
  { did },
) => {
  return client.create(block, {
    subject: did,
    createdAt: currentDatetimeString(),
  })
}

/**
 * Unblock an actor (user) by deleting a block record by URI.
 */
export const unblockActor: Action<AtUriString, void> = async (
  client,
  blockUri,
) => {
  const urip = new AtUri(blockUri)
  await client.delete(block, {
    rkey: urip.rkeySafe,
    repo: urip.hostname,
  })
}

/**
 * Mute all accounts in a list.
 */
export const muteActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  await client.call(muteActorListLexicon, { list })
}

/**
 * Unmute all accounts in a list.
 */
export const unmuteActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  await client.call(unmuteActorListLexicon, { list })
}

/**
 * Block a list by creating a listblock record.
 */
export const blockActorList: Action<
  { list: AtUriString },
  CreateOutput
> = async (client, { list }) => {
  return client.create(listblock, {
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
  const listRes = await client.call(getList, {
    list,
    limit: 1,
  })
  const blocked = listRes.list.viewer?.blocked
  if (blocked) {
    const urip = new AtUri(blocked)
    await client.delete(listblock, {
      rkey: urip.rkey,
    })
  }
}
