import { type Action } from '@atproto/lex'
import type { DatetimeString } from '@atproto/syntax'
import { currentDatetimeString } from '@atproto/syntax'
import { main as updateSeen } from '../lexicons/app/bsky/notification/updateSeen.defs.js'

/**
 * Mark notifications as seen up to (and including) the given ISO timestamp.
 * Defaults to the current time if not provided.
 */
export const updateSeenNotifications: Action<
  DatetimeString | undefined,
  void
> = async (client, seenAt = currentDatetimeString()) => {
  await client.call(updateSeen, { seenAt })
}
