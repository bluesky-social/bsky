import { type Action } from '@atproto/lex'
import type { DatetimeString } from '@atproto/syntax'
import { currentDatetimeString } from '@atproto/syntax'
import { app as appLexicons } from '../lexicons/index.js'

/**
 * Mark notifications as seen up to (and including) the given ISO timestamp.
 * Defaults to the current time if not provided.
 */
export const updateSeenNotifications: Action<
  DatetimeString | undefined,
  void
> = async (client, seenAt = currentDatetimeString()) => {
  await client.call(appLexicons.bsky.notification.updateSeen.main, { seenAt })
}
