import { type Action } from '@atproto/lex-client'
import type { DatetimeString } from '@atproto/syntax'
import { currentDatetimeString } from '@atproto/syntax'
import { app as appLexicons } from '../lexicons/index.js'

/**
 * Mark notifications as seen up to (and including) the given ISO timestamp.
 * Defaults to the current time if not provided.
 */
export const updateSeenNotifications: Action<string | undefined, void> = async (
  client,
  seenAt,
) => {
  await client.xrpc(appLexicons.bsky.notification.updateSeen.main, {
    body: {
      seenAt: (seenAt as DatetimeString | undefined) ?? currentDatetimeString(),
    },
  })
}
