import { AtUri, isDidIdentifier } from '@atproto/syntax'
import { ModerationDecision } from '../decision.js'
import {
  type ModerationOpts,
  type ModerationSubjectViewExternal,
} from '../types.js'

export function decideViewExternal(
  subject: ModerationSubjectViewExternal,
  opts: ModerationOpts,
): ModerationDecision {
  const acc = new ModerationDecision()

  /*
   * When the external view is backed by Atmosphere records, the owner of the
   * primary (or at least, first-returned) backing record is the closest analog
   * to an author. This isn't perfect, but it should be good enough for our
   * current purposes.
   */
  const ownerUri = subject.associatedRefs?.[0]?.uri
  if (ownerUri) {
    const ownerDid = new AtUri(ownerUri).hostname
    if (isDidIdentifier(ownerDid)) {
      acc.setDid(ownerDid)
      acc.setIsMe(ownerDid === opts.userDid)
    }
  }
  if (subject.labels?.length) {
    for (const label of subject.labels) {
      acc.addLabel('content', label, opts)
    }
  }
  return acc
}
