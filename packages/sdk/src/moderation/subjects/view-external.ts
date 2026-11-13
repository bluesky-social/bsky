import { AtUri, isDidIdentifier } from '@atproto/syntax'
import type { ProfileViewBasic } from '../../lexicons/app/bsky/actor/defs.defs.js'
import { ModerationDecision } from '../decision.js'
import { matchMuteWords } from '../mutewords.js'
import {
  type ModerationExternalViewOpts,
  type ModerationOpts,
  type ModerationSubjectExternalView,
} from '../types.js'
import { decideAccount } from './account.js'
import { decideProfile } from './profile.js'

export function decideViewExternal(
  subject: ModerationSubjectExternalView,
  opts: ModerationOpts,
  { texts = [] }: ModerationExternalViewOpts = {},
): ModerationDecision {
  const acc = new ModerationDecision()
  let owner: ProfileViewBasic | undefined

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
      owner = subject.associatedProfiles?.find(
        (profile) => profile.did === ownerDid,
      )
    }
  }
  if (subject.labels?.length) {
    for (const label of subject.labels) {
      acc.addLabel('content', label, opts)
    }
  }
  if (!acc.isMe && opts.prefs.mutedWords.length) {
    for (const text of texts) {
      const matches = matchMuteWords({
        mutedWords: opts.prefs.mutedWords,
        text,
        actor: owner,
      })
      if (matches) {
        acc.addMutedWord(matches)
        break
      }
    }
  }

  return ModerationDecision.merge(
    acc,
    owner ? decideAccount(owner, opts) : undefined,
    owner ? decideProfile(owner, opts) : undefined,
  )
}
