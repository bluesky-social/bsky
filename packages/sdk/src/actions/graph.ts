import {
  type Action,
  type AtIdentifierString,
  type CreateOutput,
} from '@atproto/lex'
import { AtUri, type AtUriString, currentDatetimeString } from '@atproto/syntax'
import type { app } from '../lexicons/index.js'
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
  await client.xrpc(appLexicons.bsky.graph.muteActor.main, {
    body: { actor, onlyReposts, onlyQuoteposts },
  })
}

/**
 * Unmute an actor (user).
 */
export const unmuteActor: Action<{ actor: AtIdentifierString }, void> = async (
  client,
  { actor },
) => {
  await client.xrpc(appLexicons.bsky.graph.unmuteActor.main, {
    body: { actor },
  })
}

/**
 * Mute all accounts in a list.
 */
export const muteActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  await client.xrpc(appLexicons.bsky.graph.muteActorList.main, {
    body: { list },
  })
}

/**
 * Unmute all accounts in a list.
 */
export const unmuteActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  await client.xrpc(appLexicons.bsky.graph.unmuteActorList.main, {
    body: { list },
  })
}

/**
 * Block a list by creating a listblock record.
 */
export const blockActorList: Action<
  { list: AtUriString },
  CreateOutput
> = async (client, { list }) => {
  const res = await client.createRecord({
    $type: 'app.bsky.graph.listblock',
    subject: list,
    createdAt: currentDatetimeString(),
  } satisfies app.bsky.graph.listblock.Main)
  return res.body
}

/**
 * Unblock a list by deleting the listblock record.
 * Looks up the existing block via getList viewer.blocked.
 */
export const unblockActorList: Action<{ list: AtUriString }, void> = async (
  client,
  { list },
) => {
  const listRes = await client.xrpc(appLexicons.bsky.graph.getList.main, {
    params: { list, limit: 1 },
  })
  const blocked = listRes.body.list.viewer?.blocked
  if (blocked) {
    const urip = new AtUri(blocked)
    await client.deleteRecord('app.bsky.graph.listblock', urip.rkey)
  }
}
