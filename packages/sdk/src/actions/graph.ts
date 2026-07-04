import {
  type Action,
  type AtIdentifierString,
  type NsidString,
} from '@atproto/lex-client'
import { AtUri, type AtUriString } from '@atproto/syntax'
import { app as appLexicons, com as comLexicons } from '../lexicons/index.js'

type CreateOutput = { uri: string; cid: string }

/**
 * Mute an actor (user).
 */
export const muteActor: Action<{ actor: string }, void> = async (
  client,
  { actor },
) => {
  await client.xrpc(appLexicons.bsky.graph.muteActor.main, {
    body: { actor: actor as AtIdentifierString },
  })
}

/**
 * Unmute an actor (user).
 */
export const unmuteActor: Action<{ actor: string }, void> = async (
  client,
  { actor },
) => {
  await client.xrpc(appLexicons.bsky.graph.unmuteActor.main, {
    body: { actor: actor as AtIdentifierString },
  })
}

/**
 * Mute all accounts in a list.
 */
export const muteActorList: Action<{ list: string }, void> = async (
  client,
  { list },
) => {
  await client.xrpc(appLexicons.bsky.graph.muteActorList.main, {
    body: { list: list as AtUriString },
  })
}

/**
 * Unmute all accounts in a list.
 */
export const unmuteActorList: Action<{ list: string }, void> = async (
  client,
  { list },
) => {
  await client.xrpc(appLexicons.bsky.graph.unmuteActorList.main, {
    body: { list: list as AtUriString },
  })
}

/**
 * Block a list by creating a listblock record.
 */
export const blockActorList: Action<{ list: string }, CreateOutput> = async (
  client,
  { list },
) => {
  const res = await client.xrpc(comLexicons.atproto.repo.createRecord.main, {
    body: {
      repo: client.assertDid,
      collection: 'app.bsky.graph.listblock' as NsidString,
      record: {
        $type: 'app.bsky.graph.listblock',
        subject: list as AtUriString,
        createdAt: new Date().toISOString(),
      },
    },
  })
  return res.body as CreateOutput
}

/**
 * Unblock a list by deleting the listblock record.
 * Looks up the existing block via getList viewer.blocked.
 */
export const unblockActorList: Action<{ list: string }, void> = async (
  client,
  { list },
) => {
  const listRes = await client.xrpc(appLexicons.bsky.graph.getList.main, {
    params: { list: list as AtUriString, limit: 1 },
  })
  const blocked = listRes.body.list.viewer?.blocked
  if (blocked) {
    const urip = new AtUri(blocked)
    await client.xrpc(comLexicons.atproto.repo.deleteRecord.main, {
      body: {
        repo: client.assertDid,
        collection: 'app.bsky.graph.listblock' as NsidString,
        rkey: urip.rkey,
      },
    })
  }
}
