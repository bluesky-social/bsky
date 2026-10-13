import { AtUri, isDidIdentifier } from '@atproto/syntax'
import { ModerationDecision } from '../decision.js'
import {
  type ModerationOpts,
  type ModerationSubjectProfileLink,
} from '../types.js'

export function decideProfileLink(
  subject: ModerationSubjectProfileLink,
  opts: ModerationOpts,
): ModerationDecision {
  const acc = new ModerationDecision()

  /*
   * A link view carries no owner profile. The repo that holds the link record
   * is the owner, so derive it from the record URI (never from the destination
   * URL or a label's source).
   */
  const ownerDid = new AtUri(subject.uri).hostname
  if (isDidIdentifier(ownerDid)) {
    acc.setDid(ownerDid)
    acc.setIsMe(ownerDid === opts.userDid)
  }

  for (const label of subject.labels ?? []) {
    acc.addLabel('content', label, opts)
  }
  return acc
}
