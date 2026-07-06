import { type Action, type AtIdentifierString } from '@atproto/lex-client'
import { AtUri, type AtUriString, currentDatetimeString } from '@atproto/syntax'
import { app as appLexicons, com as comLexicons } from '../lexicons/index.js'

type CreateOutput = { uri: string; cid: string }

/**
 * Mute an actor (user).
 */
export const muteActor: Action<{ actor: AtIdentifierString }, void> = async (
  client,
  { actor },
) => {
  await client.xrpc(appLexicons.bsky.graph.muteActor.main, {
    body: { actor },
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
  const res = await client.xrpc(comLexicons.atproto.repo.createRecord.main, {
    body: {
      repo: client.assertDid,
      collection: 'app.bsky.graph.listblock',
      record: {
        $type: 'app.bsky.graph.listblock',
        subject: list,
        createdAt: currentDatetimeString(),
      },
    },
  })
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
    await client.xrpc(comLexicons.atproto.repo.deleteRecord.main, {
      body: {
        repo: client.assertDid,
        collection: 'app.bsky.graph.listblock',
        rkey: urip.rkey,
      },
    })
  }
}
